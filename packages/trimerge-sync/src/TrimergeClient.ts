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
import { CommitDoc, Differ } from './differ';
import { getFullId } from './util';
import { OnChangeFn, SubscriberList } from './lib/SubscriberList';

type AddCommitType =
  // Added from this client
  | 'local'
  // Added from outside the client (e.g. a store)
  | 'external'
  // Added from this client, but don't sync to store
  | 'lazy';

export class TrimergeClient<
  SavedDoc,
  LatestDoc extends SavedDoc,
  EditMetadata,
  Delta,
  Presence,
> {
  private lastSaved?: CommitDoc<SavedDoc, EditMetadata>;
  private lastNonLazy?: CommitDoc<SavedDoc, EditMetadata>;
  private latestDoc?: CommitDoc<LatestDoc, EditMetadata>;
  private lastLocalSyncId: string | undefined;

  private docSubs = new SubscriberList(() => this.doc);
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

  private clientMap = new Map<string, LocalClientInfo<Presence>>();
  private clientList: ClientList<Presence> = [];

  private commits = new Map<string, Commit<EditMetadata, Delta>>();
  private docs = new Map<string, CommitDoc<SavedDoc, EditMetadata>>();
  private headRefs = new Set<string>();

  private store: LocalStore<EditMetadata, Delta, Presence>;
  private lazyCommits = new Map<string, Commit<EditMetadata, Delta>>();
  private unsyncedCommits: Commit<EditMetadata, Delta>[] = [];

  private selfFullId: string;
  private newPresence: ClientInfo<Presence> | undefined;

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
      Presence
    >,
    private readonly differ: Differ<SavedDoc, LatestDoc, EditMetadata, Delta>,
  ) {
    this.selfFullId = getFullId(userId, clientId);
    this.store = getLocalStore(userId, clientId, this.onEvent);
    this.setClientInfo({
      userId,
      clientId,
      ref: undefined,
      presence: undefined,
      self: true,
    });
  }

  public get isRemoteLeader(): boolean {
    return this.store.isRemoteLeader;
  }

  private setClientInfo(cursor: LocalClientInfo<Presence>) {
    const { userId, clientId } = cursor;
    this.clientMap.set(getFullId(userId, clientId), cursor);
    this.emitClientListChange();
  }
  private onEvent: OnEventFn<EditMetadata, Delta, Presence> = (event) => {
    switch (event.type) {
      case 'commits': {
        const { commits, syncId, clientInfo } = event;
        for (const commit of commits) {
          this.addCommit(commit, 'external');
        }
        this.lastLocalSyncId = syncId;
        this.mergeHeads();
        this.docSubs.emitChange();
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

  get doc(): LatestDoc | undefined {
    if (this.lastSaved === undefined) {
      return undefined;
    }
    if (this.latestDoc === undefined) {
      this.latestDoc = this.migrateCommit(this.lastSaved);
    }
    return this.latestDoc.doc;
  }
  get syncStatus(): SyncStatus {
    return this.syncState;
  }
  get clients(): ClientList<Presence> {
    return this.clientList;
  }

  subscribeDoc(onChange: OnChangeFn<LatestDoc | undefined>) {
    return this.docSubs.subscribe(onChange);
  }

  subscribeSyncStatus(onChange: OnChangeFn<SyncStatus>) {
    return this.syncStateSubs.subscribe(onChange);
  }

  subscribeClientList(onChange: OnChangeFn<ClientList<Presence>>) {
    return this.clientListSubs.subscribe(onChange);
  }

  updateDoc(doc: LatestDoc, editMetadata: EditMetadata, presence?: Presence) {
    const ref = this.addNewCommit(doc, editMetadata, false);
    this.setPresence(presence, ref);
    this.mergeHeads();
    this.docSubs.emitChange();
    this.sync();
  }

  updatePresence(state: Presence) {
    this.setPresence(state);
    this.sync();
  }

  private setPresence(
    presence: Presence | undefined,
    ref = this.lastSaved?.ref,
  ) {
    const { userId, clientId } = this;
    this.newPresence = { userId, clientId, ref, presence };
    this.setClientInfo({ userId, clientId, ref, presence, self: true });
    this.emitClientListChange();
  }

  getCommitDoc(ref: string): CommitDoc<SavedDoc, EditMetadata> {
    const doc = this.docs.get(ref);
    if (doc !== undefined) {
      return doc;
    }
    const commit = this.getCommit(ref);
    const baseValue = commit.baseRef
      ? this.getCommitDoc(commit.baseRef).doc
      : undefined;
    const commitDoc: CommitDoc<SavedDoc, EditMetadata> = {
      ref: commit.ref,
      doc: this.differ.patch(baseValue, commit.delta),
      editMetadata: commit.editMetadata,
    };
    this.docs.set(ref, commitDoc);
    return commitDoc;
  }

  getCommit = (ref: string) => {
    const commit = this.commits.get(ref);
    if (commit) {
      return commit;
    }
    throw new Error(`unknown ref "${ref}"`);
  };

  private migrateCommit(
    commit: CommitDoc<SavedDoc, EditMetadata>,
  ): CommitDoc<LatestDoc, EditMetadata> {
    const { doc, editMetadata } = this.differ.migrate(
      commit.doc,
      commit.editMetadata,
    );
    if (commit.doc === doc) {
      return { ...commit, doc };
    }
    const ref = this.addNewCommit(doc, editMetadata, true, commit);
    return { ref, doc, editMetadata };
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
            ? this.migrateCommit(this.getCommitDoc(baseRef))
            : undefined;
        const left = this.migrateCommit(this.getCommitDoc(leftRef));
        const right = this.migrateCommit(this.getCommitDoc(rightRef));
        const {
          doc,
          editMetadata,
          lazy = true,
        } = this.differ.merge(base, left, right);
        return this.addNewCommit(
          doc,
          editMetadata,
          lazy,
          left,
          rightRef,
          baseRef,
        );
      },
    );
    // TODO: update Presence(s) based on this merge
    // TODO: can we clear out commits we don't need anymore?
  }

  private emitClientListChange() {
    this.clientList = Array.from(this.clientMap.values());
    this.clientListSubs.emitChange();
  }
  private sync(): void {
    const commits = this.unsyncedCommits;
    if (commits.length > 0 || this.newPresence !== undefined) {
      this.unsyncedCommits = [];
      this.updateSyncState({ localSave: 'saving' });
      this.store.update(commits, this.newPresence);
      this.newPresence = undefined;
    }
    this.updateSyncState({ localSave: 'ready' });
  }

  private updateSyncState(update: Partial<SyncStatus>): void {
    this.syncState = { ...this.syncState, ...update };
    this.syncStateSubs.emitChange();
  }

  private rollbackLazyCommits() {
    for (const { ref, baseRef, mergeRef } of this.lazyCommits.values()) {
      if (this.headRefs.has(ref)) {
        this.headRefs.delete(ref);
        if (baseRef) {
          this.headRefs.add(baseRef);
        }
        if (mergeRef) {
          this.headRefs.add(mergeRef);
        }
      }
      this.commits.delete(ref);
      this.docs.delete(ref);
    }
    this.lazyCommits.clear();
  }

  private addCommit(
    commit: Commit<EditMetadata, Delta>,
    type: AddCommitType,
  ): void {
    const { ref, baseRef, mergeRef } = commit;
    if (this.commits.has(ref)) {
      // Promote lazy commit
      if (type === 'external') {
        this.lazyCommits.delete(ref);
      } else {
        console.warn(
          `[TRIMERGE-SYNC] skipping add commit ${ref}, base ${baseRef}, merge ${mergeRef} (type=${type})`,
        );
      }
      return;
    }

    if (type === 'external') {
      // Roll back to non-lazy commit
      if (this.lastSaved !== this.lastNonLazy) {
        this.lastSaved = this.lastNonLazy;
        this.latestDoc = undefined;
      }
      // Remove all lazy commits
      this.rollbackLazyCommits();
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
    const currentRef = this.lastSaved?.ref;
    if (currentRef === commit.baseRef || currentRef === commit.mergeRef) {
      this.lastSaved = this.getCommitDoc(commit.ref);
      if (type !== 'lazy') {
        this.lastNonLazy = this.lastSaved;
      }
      this.latestDoc = undefined;
    }
    switch (type) {
      case 'lazy':
        this.lazyCommits.set(commit.ref, commit);
        break;
      case 'local':
        this.promoteLazyCommit(baseRef);
        this.promoteLazyCommit(mergeRef);
        this.unsyncedCommits.push(commit);
        break;
    }
  }

  private promoteLazyCommit(ref?: string) {
    if (!ref) {
      return;
    }
    const commit = this.lazyCommits.get(ref);
    if (commit) {
      this.promoteLazyCommit(commit.baseRef);
      this.promoteLazyCommit(commit.mergeRef);
      this.lazyCommits.delete(ref);
      this.unsyncedCommits.push(commit);
    }
    if (this.lastSaved?.ref === ref) {
      this.lastNonLazy = this.lastSaved;
    }
  }

  private addNewCommit(
    newDoc: LatestDoc,
    editMetadata: EditMetadata,
    lazy: boolean,
    base: CommitDoc<SavedDoc, EditMetadata> | undefined = this.lastSaved,
    mergeRef?: string,
    mergeBaseRef?: string,
  ): string {
    const { userId, clientId } = this;
    const delta = this.differ.diff(base?.doc, newDoc);
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
