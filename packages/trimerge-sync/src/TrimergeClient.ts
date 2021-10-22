import {
  ClientInfo,
  ClientList,
  Commit,
  GetLocalStoreFn,
  LocalClientInfo,
  LocalStore,
  OnEventFn,
  SyncStatus,
} from './types';
import { mergeHeads } from './merge-heads';
import { Differ, CommitState } from './differ';
import { getFullId } from './util';
import { OnChangeFn, SubscriberList } from './lib/SubscriberList';
import { timeout } from './lib/Timeout';

export class TrimergeClient<
  SavedState,
  State extends SavedState,
  EditMetadata,
  Delta,
  PresenceState,
> {
  private currentSaved?: CommitState<SavedState, EditMetadata>;
  private currentState?: CommitState<State, EditMetadata>;
  private lastLocalSyncId: string | undefined;

  private stateSubs = new SubscriberList(() => this.state);
  private syncStateSubs = new SubscriberList(
    () => this.syncState,
    (a, b) =>
      a.localRead === b.localRead &&
      a.localSave === b.localSave &&
      a.remoteRead === b.remoteRead &&
      a.remoteSave === b.remoteSave &&
      a.remoteConnect === b.remoteConnect,
  );
  private clientListSubs = new SubscriberList(() => this.clientList);

  private clientMap = new Map<string, LocalClientInfo<PresenceState>>();
  private clientList: ClientList<PresenceState> = [];

  private commits = new Map<string, Commit<EditMetadata, Delta>>();
  private values = new Map<string, CommitState<SavedState, EditMetadata>>();
  private headRefs = new Set<string>();

  private store: LocalStore<EditMetadata, Delta, PresenceState>;
  private lazyCommits = new Map<string, Commit<EditMetadata, Delta>>();
  private unsyncedCommits: Commit<EditMetadata, Delta>[] = [];

  private selfFullId: string;
  private newPresenceState: ClientInfo<PresenceState> | undefined;

  private syncState: SyncStatus = {
    localRead: 'loading',
    localSave: 'ready',
    remoteConnect: 'offline',
    remoteRead: 'offline',
    remoteSave: 'ready',
  };

  constructor(
    public readonly userId: string,
    public readonly clientId: string,
    private readonly getLocalStore: GetLocalStoreFn<
      EditMetadata,
      Delta,
      PresenceState
    >,
    private readonly differ: Differ<SavedState, State, EditMetadata, Delta>,
    private readonly bufferMs: number,
  ) {
    this.selfFullId = getFullId(userId, clientId);
    this.store = getLocalStore(userId, clientId, this.onEvent);
    this.setClientInfo({
      userId,
      clientId,
      ref: undefined,
      state: undefined,
      self: true,
    });
  }

  public get isRemoteLeader(): boolean {
    return this.store.isRemoteLeader;
  }

  private setClientInfo(cursor: LocalClientInfo<PresenceState>) {
    const { userId, clientId } = cursor;
    this.clientMap.set(getFullId(userId, clientId), cursor);
    this.emitClientListChange();
  }
  private onEvent: OnEventFn<EditMetadata, Delta, PresenceState> = (event) => {
    switch (event.type) {
      case 'commits': {
        const { commits, syncId, clientInfo } = event;
        for (const commit of commits) {
          this.addCommit(commit, 'remote');
        }
        this.lastLocalSyncId = syncId;
        this.mergeHeads();
        this.stateSubs.emitChange();
        this.sync();
        if (clientInfo) {
          this.setClientInfo(clientInfo);
        }

        break;
      }

      case 'ack':
        this.lastLocalSyncId = event.syncId;
        break;

      case 'client-leave':
        this.clientMap.delete(getFullId(event.userId, event.clientId));
        this.emitClientListChange();
        break;

      case 'client-join':
      case 'client-presence':
        this.setClientInfo(event.info);
        break;

      case 'remote-state':
        // TODO: remove remote clients as applicable?
        this.emitClientListChange();
        const changes: Partial<SyncStatus> = {};
        if (event.connect) {
          changes.remoteConnect = event.connect;
        }
        if (event.read) {
          changes.remoteRead = event.read;
        }
        if (event.save) {
          changes.remoteSave = event.save;
        }
        this.updateSyncState(changes);
        break;

      case 'ready':
        this.updateSyncState({ localRead: 'ready' });
        break;
      case 'error':
        if (event.code === 'internal') {
          this.updateSyncState({ localRead: 'error' });
        }
        break;

      default:
        console.warn(`unknown event: ${event['type']}`);
        break;
    }
  };

  get state(): State | undefined {
    if (this.currentSaved === undefined) {
      return undefined;
    }
    if (this.currentState === undefined) {
      this.currentState = this.migrateCommit(this.currentSaved);
    }
    return this.currentState.state;
  }
  get syncStatus(): SyncStatus {
    return this.syncState;
  }
  get clients(): ClientList<PresenceState> {
    return this.clientList;
  }

  subscribeState(onChange: OnChangeFn<State | undefined>) {
    return this.stateSubs.subscribe(onChange);
  }

  subscribeSyncStatus(onChange: OnChangeFn<SyncStatus>) {
    return this.syncStateSubs.subscribe(onChange);
  }

  subscribeClientList(onChange: OnChangeFn<ClientList<PresenceState>>) {
    return this.clientListSubs.subscribe(onChange);
  }

  updateState(
    value: State,
    editMetadata: EditMetadata,
    presenceState?: PresenceState,
  ) {
    const ref = this.addNewCommit(value, editMetadata, false);
    this.setPresenceState(presenceState, ref);
    this.mergeHeads();
    this.stateSubs.emitChange();
    this.sync();
  }

  updatePresence(state: PresenceState) {
    this.setPresenceState(state);
    this.sync();
  }

  private setPresenceState(
    state: PresenceState | undefined,
    ref = this.currentSaved?.ref,
  ) {
    const { userId, clientId } = this;
    this.newPresenceState = { userId, clientId, ref, state };
    this.setClientInfo({ userId, clientId, ref, state, self: true });
    this.emitClientListChange();
  }

  getCommitState(ref: string): CommitState<SavedState, EditMetadata> {
    const value = this.values.get(ref);
    if (value !== undefined) {
      return value;
    }
    const commit = this.getCommit(ref);
    const baseValue = commit.baseRef
      ? this.getCommitState(commit.baseRef).state
      : undefined;
    const valueState: CommitState<SavedState, EditMetadata> = {
      ref: commit.ref,
      state: this.differ.patch(baseValue, commit.delta),
      editMetadata: commit.editMetadata,
    };
    this.values.set(ref, valueState);
    return valueState;
  }

  getCommit = (ref: string) => {
    const commit = this.commits.get(ref);
    if (commit) {
      return commit;
    }
    throw new Error(`unknown ref "${ref}"`);
  };

  private migrateCommit(
    commit: CommitState<SavedState, EditMetadata>,
  ): CommitState<State, EditMetadata> {
    const { state, editMetadata } = this.differ.migrate(
      commit.state,
      commit.editMetadata,
    );
    if (commit.state === state) {
      return { ...commit, state };
    }
    const ref = this.addNewCommit(state, editMetadata, true, commit);
    return { ref, state, editMetadata };
  }

  private mergeHeads() {
    if (this.headRefs.size <= 1) {
      return;
    }
    mergeHeads(
      Array.from(this.headRefs),
      this.getCommit,
      (baseRef, leftRef, rightRef) => {
        const base =
          baseRef !== undefined
            ? this.migrateCommit(this.getCommitState(baseRef))
            : undefined;
        const left = this.migrateCommit(this.getCommitState(leftRef));
        const right = this.migrateCommit(this.getCommitState(rightRef));
        const {
          state,
          editMetadata,
          lazy = false,
        } = this.differ.merge(base, left, right);
        return this.addNewCommit(
          state,
          editMetadata,
          lazy,
          left,
          rightRef,
          baseRef,
        );
      },
    );
    // TODO: update PresenceState(s) based on this merge
    // TODO: can we clear out commits we don't need anymore?
  }

  private syncPromise: Promise<boolean> | undefined;

  private emitClientListChange() {
    this.clientList = Array.from(this.clientMap.values());
    this.clientListSubs.emitChange();
  }

  private get needsSync(): boolean {
    return (
      this.unsyncedCommits.length > 0 || this.newPresenceState !== undefined
    );
  }
  private sync(): void {
    if (!this.syncPromise && this.needsSync) {
      this.syncPromise = this.doSync();
    }
  }

  private updateSyncState(update: Partial<SyncStatus>) {
    this.syncState = { ...this.syncState, ...update };
    this.syncStateSubs.emitChange();
  }

  private async doSync() {
    while (this.needsSync) {
      this.updateSyncState({ localSave: 'pending' });
      await timeout(this.bufferMs);
      const commits = this.unsyncedCommits;
      this.unsyncedCommits = [];
      this.updateSyncState({ localSave: 'saving' });
      this.store.update(commits, this.newPresenceState);
      this.newPresenceState = undefined;
    }
    this.updateSyncState({ localSave: 'ready' });
    this.syncPromise = undefined;
    return true;
  }

  private addCommit(
    commit: Commit<EditMetadata, Delta>,
    type: 'local' | 'remote' | 'lazy',
  ): void {
    const { ref, baseRef, mergeRef } = commit;
    if (this.commits.has(ref)) {
      console.warn(
        `[TRIMERGE-SYNC] skipping add commit ${ref}, base ${baseRef}, merge ${mergeRef} (type=${type})`,
      );
      return;
    }
    this.commits.set(ref, commit);
    if (baseRef !== undefined) {
      if (!this.commits.has(baseRef)) {
        throw new Error(`unknown baseRef ${baseRef}`);
      }
      this.headRefs.delete(baseRef);
    }
    if (mergeRef !== undefined) {
      if (!this.commits.has(mergeRef)) {
        throw new Error(`unknown mergeRef ${mergeRef}`);
      }
      this.headRefs.delete(mergeRef);
    }
    this.headRefs.add(ref);
    const currentRef = this.currentSaved?.ref;
    if (currentRef === commit.baseRef || currentRef === commit.mergeRef) {
      this.currentSaved = this.getCommitState(commit.ref);
      this.currentState = undefined;
    }
    switch (type) {
      case 'lazy':
        this.lazyCommits.set(commit.ref, commit);
        break;
      case 'local':
        this.unsyncedCommits.push(commit);
        break;
    }
  }

  private addNewCommit(
    newValue: State,
    editMetadata: EditMetadata,
    lazy: boolean,
    base: CommitState<SavedState, EditMetadata> | undefined = this.currentSaved,
    mergeRef?: string,
    mergeBaseRef?: string,
  ): string {
    const { userId, clientId } = this;
    const delta = this.differ.diff(base?.state, newValue);
    const baseRef = base?.ref;
    const ref = this.differ.computeRef(baseRef, mergeRef, delta, editMetadata);
    const commit: Commit<EditMetadata, Delta> = {
      userId,
      clientId,
      ref,
      baseRef,
      mergeRef,
      mergeBaseRef,
      delta,
      editMetadata,
    };
    this.addCommit(commit, lazy ? 'lazy' : 'local');
    return ref;
  }

  public shutdown(): Promise<void> | void {
    return this.store.shutdown();
  }
}
