import type {
  ClientInfo,
  ClientList,
  Commit,
  LocalClientInfo,
  LocalStore,
  OnStoreEventFn,
  SyncStatus,
} from './types';
import {
  AddNewCommitMetadataFn,
  CommitDoc,
  ComputeRefFn,
  Differ,
  DocCache,
  MergeAllBranchesFn,
  MergeHelpers,
  MigrateDocFn,
  TrimergeClientOptions,
} from './TrimergeClientOptions';
import { getFullId } from './util';
import { OnChangeFn, SubscriberList } from './lib/SubscriberList';
import { asCommitRefs, CommitRefs } from './lib/Commits';
import { mergeMetadata } from './lib/mergeMetadata';
import { InMemoryDocCache } from './InMemoryDocCache';

type AddCommitType =
  // Added from this client
  | 'local'
  // Added from outside the client (e.g. a store)
  | 'external'
  // Added from this client, but don't sync to store
  | 'temp';

export type SubscribeEvent = {
  origin:
    | 'subscribe' // We send an initial event when you first subscribe
    | 'self' // We send an event when you explicitly update the value
    | 'local' // Another client on the same store updated the value
    | 'remote'; // A remote client updated the value
};

export class TrimergeClient<
  SavedDoc,
  LatestDoc extends SavedDoc,
  CommitMetadata,
  Delta,
  Presence,
> {
  // The doc for the latest non-temp commit
  // This is used when rolling back all temp commits
  private lastNonTempDoc?: CommitDoc<SavedDoc, CommitMetadata>;

  // The doc for the latest commit (potentially temp)
  private lastSavedDoc?: CommitDoc<SavedDoc, CommitMetadata>;

  // A cached migrated version of lastSavedDoc (could be instance equal)
  private latestDoc?: CommitDoc<LatestDoc, CommitMetadata>;

  private docSubs = new SubscriberList<LatestDoc | undefined, SubscribeEvent>(
    () => this.doc,
  );
  private syncStateSubs = new SubscriberList<SyncStatus, SubscribeEvent>(
    () => this.syncState,
    (a, b) =>
      a.localRead === b.localRead &&
      a.localSave === b.localSave &&
      a.remoteRead === b.remoteRead &&
      a.remoteSave === b.remoteSave &&
      a.remoteConnect === b.remoteConnect,
  );
  private clientListSubs = new SubscriberList<
    ClientList<Presence>,
    SubscribeEvent
  >(() => this.clientList);

  private clientMap = new Map<string, LocalClientInfo<Presence>>();
  private clientList: ClientList<Presence> = [];

  private commits = new Map<string, Commit<CommitMetadata, Delta>>();
  private allHeadRefs = new Set<string>();
  private nonTempHeadRefs = new Set<string>();

  private store: LocalStore<CommitMetadata, Delta, Presence>;
  private readonly differ: Differ<SavedDoc, Delta>;
  private readonly migrate: MigrateDocFn<SavedDoc, LatestDoc, CommitMetadata>;
  private readonly mergeAllBranches: MergeAllBranchesFn<
    LatestDoc,
    CommitMetadata
  >;
  private readonly computeRef: ComputeRefFn<Delta>;
  private readonly addNewCommitMetadata:
    | AddNewCommitMetadataFn<CommitMetadata>
    | undefined;
  private readonly docCache: DocCache<SavedDoc, CommitMetadata>;
  private tempCommits = new Map<string, Commit<CommitMetadata, Delta>>();
  private unsyncedCommits: Commit<CommitMetadata, Delta>[] = [];

  private newPresence: ClientInfo<Presence> | undefined;

  private numPendingUpdates: number = 0;

  private syncState: SyncStatus = {
    localRead: 'loading',
    localSave: 'ready',
    remoteConnect: 'offline',
    remoteRead: 'loading',
    remoteSave: 'ready',
    remoteCursor: undefined,
  };

  constructor(
    public readonly userId: string,
    public readonly clientId: string,
    {
      differ,
      migrate = (doc, metadata) => ({ doc: doc as LatestDoc, metadata }),
      mergeAllBranches,
      computeRef,
      getLocalStore,
      addNewCommitMetadata,
      docCache = new InMemoryDocCache(),
    }: TrimergeClientOptions<
      SavedDoc,
      LatestDoc,
      CommitMetadata,
      Delta,
      Presence
    >,
  ) {
    this.differ = differ;
    this.migrate = migrate;
    this.mergeAllBranches = mergeAllBranches;
    this.computeRef = computeRef;
    this.addNewCommitMetadata = addNewCommitMetadata;
    this.docCache = docCache;
    this.store = getLocalStore(userId, clientId, this.onStoreEvent);
    this.setClientInfo(
      {
        userId,
        clientId,
        ref: undefined,
        presence: undefined,
        self: true,
      },
      { origin: 'self' },
    );
  }

  public get isRemoteLeader(): boolean {
    return this.store.isRemoteLeader;
  }

  private setClientInfo(
    cursor: LocalClientInfo<Presence>,
    event: SubscribeEvent,
  ) {
    const { userId, clientId } = cursor;
    this.clientMap.set(getFullId(userId, clientId), cursor);
    this.emitClientListChange(event);
  }
  private onStoreEvent: OnStoreEventFn<CommitMetadata, Delta, Presence> = (
    event,
    remoteOrigin,
  ) => {
    const origin = remoteOrigin ? 'remote' : 'local';

    switch (event.type) {
      case 'commits': {
        const { commits, clientInfo } = event;
        for (const commit of commits) {
          this.addCommit(commit, 'external');
        }
        this.mergeHeads();
        this.docSubs.emitChange({ origin });
        void this.sync();
        if (clientInfo) {
          this.setClientInfo(clientInfo, { origin });
        }

        break;
      }

      case 'ack':
        break;

      case 'client-leave':
        this.clientMap.delete(getFullId(event.userId, event.clientId));
        this.emitClientListChange({ origin });
        break;

      case 'client-join':
      case 'client-presence':
        this.setClientInfo(event.info, { origin });
        break;

      case 'remote-state':
        // TODO: remove remote clients as applicable?
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
        if (event.cursor) {
          changes.remoteCursor = event.cursor;
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
    if (this.lastSavedDoc === undefined) {
      return undefined;
    }
    if (this.latestDoc === undefined) {
      this.latestDoc = this.migrateCommit(this.lastSavedDoc);
    }
    return this.latestDoc.doc;
  }
  get syncStatus(): SyncStatus {
    return this.syncState;
  }
  get clients(): ClientList<Presence> {
    return this.clientList;
  }

  subscribeDoc(onChange: OnChangeFn<LatestDoc | undefined, SubscribeEvent>) {
    return this.docSubs.subscribe(onChange, { origin: 'subscribe' });
  }

  subscribeSyncStatus(onChange: OnChangeFn<SyncStatus, SubscribeEvent>) {
    return this.syncStateSubs.subscribe(onChange, { origin: 'subscribe' });
  }

  subscribeClientList(
    onChange: OnChangeFn<ClientList<Presence>, SubscribeEvent>,
  ) {
    return this.clientListSubs.subscribe(onChange, { origin: 'subscribe' });
  }

  async updateDoc(
    doc: LatestDoc,
    metadata: CommitMetadata,
    presence?: Presence,
  ): Promise<void> {
    const ref = this.addNewCommit(doc, metadata, false);
    this.setPresence(presence, ref);
    if (ref !== undefined) {
      this.mergeHeads();
      this.docSubs.emitChange({ origin: 'self' });
      return await this.sync();
    }
  }

  updatePresence(state: Presence) {
    this.setPresence(state);
    void this.sync();
  }

  private setPresence(
    presence: Presence | undefined,
    ref = this.lastSavedDoc?.ref,
  ) {
    const { userId, clientId } = this;
    this.newPresence = { userId, clientId, ref, presence };
    this.setClientInfo(
      { userId, clientId, ref, presence, self: true },
      { origin: 'self' },
    );
    this.emitClientListChange({ origin: 'self' });
  }

  getCommit = (ref: string) => {
    const commit = this.commits.get(ref);
    if (commit) {
      return commit;
    }
    throw new Error(`unknown ref "${ref}"`);
  };

  private mergeHelpers: MergeHelpers<LatestDoc, CommitMetadata> = {
    getCommitInfo: this.getCommit,
    computeLatestDoc: (ref) => this.migrateCommit(this.getCommitDoc(ref)),
    addMerge: (doc, metadata, temp, leftRef, rightRef) =>
      this.addNewCommit(
        doc,
        metadata,
        temp,
        this.getCommitDoc(leftRef),
        rightRef,
      ),
  };

  getCommitDoc(ref: string): CommitDoc<SavedDoc, CommitMetadata> {
    const doc = this.docCache.get(ref);
    if (doc !== undefined) {
      return doc;
    }
    const { baseRef, delta, metadata } = this.getCommit(ref);
    const baseValue = baseRef ? this.getCommitDoc(baseRef).doc : undefined;
    const commitDoc: CommitDoc<SavedDoc, CommitMetadata> = {
      ref,
      doc: this.differ.patch(baseValue, delta),
      metadata,
    };
    this.docCache.set(ref, commitDoc);
    return commitDoc;
  }

  private migrateCommit(
    commit: CommitDoc<SavedDoc, CommitMetadata>,
  ): CommitDoc<LatestDoc, CommitMetadata> {
    const { doc, metadata } = this.migrate(commit.doc, commit.metadata);
    if (commit.doc === doc) {
      return commit as CommitDoc<LatestDoc, CommitMetadata>;
    }
    const ref = this.addNewCommit(doc, metadata, true, commit);
    if (ref === undefined) {
      return commit as CommitDoc<LatestDoc, CommitMetadata>;
    }
    return { ref, doc, metadata };
  }

  private mergeHeads() {
    if (this.allHeadRefs.size <= 1) {
      return;
    }
    this.mergeAllBranches(Array.from(this.allHeadRefs), this.mergeHelpers);
    // TODO: update Presence(s) based on this merge
    // TODO: can we clear out commits we don't need anymore?
  }

  private emitClientListChange(event: SubscribeEvent) {
    this.clientList = Array.from(this.clientMap.values());
    this.clientListSubs.emitChange(event);
  }
  private async sync(): Promise<void> {
    const commits = this.unsyncedCommits;
    if (commits.length > 0 || this.newPresence !== undefined) {
      this.unsyncedCommits = [];
      // only indicate local save if we're syncing commits.
      if (commits.length > 0) {
        this.updateSyncState({ localSave: 'saving' });
      }
      this.numPendingUpdates++;
      try {
        await this.store.update(commits, this.newPresence);

        if (this.numPendingUpdates === 1) {
          this.updateSyncState({ localSave: 'ready' });
        }
      } catch (err) {
        this.updateSyncState({ localSave: 'error' });
        throw err;
      } finally {
        if (this.numPendingUpdates <= 0) {
          throw new Error('Assertion Error: numUnsavedCommits <= 0');
        }
        this.numPendingUpdates--;
      }

      this.newPresence = undefined;
    }
  }

  private updateSyncState(update: Partial<SyncStatus>): void {
    this.syncState = { ...this.syncState, ...update };
    this.syncStateSubs.emitChange({ origin: 'local' });
  }
  private addHead(
    headRefs: Set<string>,
    { ref, baseRef, mergeRef }: CommitRefs,
  ): void {
    if (baseRef !== undefined) {
      // When adding a head ref, we need to be able to resolve the document at ref.
      // That can be accomplished if any of the following are true:
      //
      //  1. the doc cache has a document for ref
      //  2. we have a commit for ref and we have a snapshot for baseRef
      //  3. we have a commit for ref and we have a commit for baseRef
      if (
        !this.docCache.has(ref) &&
        !this.commits.has(baseRef) &&
        !this.docCache.has(baseRef)
      ) {
        throw new Error(
          `no way to resolve ${ref}: no cached doc for ${ref} and no cached doc or commit for ${baseRef}`,
        );
      }
      headRefs.delete(baseRef);
    }
    if (mergeRef !== undefined) {
      headRefs.delete(mergeRef);
    }
    headRefs.add(ref);
  }

  private addCommit(
    commit: Commit<CommitMetadata, Delta>,
    type: AddCommitType,
  ): void {
    const { ref, baseRef, mergeRef } = asCommitRefs(commit);
    if (this.commits.has(ref)) {
      if (type === 'external') {
        this.updateCommitFromRemote(commit);
      } else {
        console.warn(
          `[TRIMERGE-SYNC] skipping add commit ${ref}, base ${baseRef}, merge ${mergeRef} (type=${type})`,
        );
      }
      return;
    }

    if (type === 'external') {
      // Roll back to non-temp commit
      if (this.lastSavedDoc !== this.lastNonTempDoc) {
        this.lastSavedDoc = this.lastNonTempDoc;
        this.latestDoc = undefined;
      }
      // Remove all temp commits
      for (const ref1 of this.tempCommits.keys()) {
        this.commits.delete(ref1);
        this.docCache.delete(ref1);
      }
      // Roll back heads
      this.allHeadRefs = new Set(this.nonTempHeadRefs);
      this.tempCommits.clear();
    }

    this.commits.set(ref, commit);
    this.addHead(this.allHeadRefs, commit);
    const currentRef = this.lastSavedDoc?.ref;
    if (!currentRef || currentRef === baseRef || currentRef === mergeRef) {
      this.lastSavedDoc = this.getCommitDoc(commit.ref);
      if (type !== 'temp') {
        this.lastNonTempDoc = this.lastSavedDoc;
      }
      this.latestDoc = undefined;
    }
    switch (type) {
      case 'temp':
        this.tempCommits.set(commit.ref, commit);
        break;
      case 'local':
        this.promoteTempCommit(baseRef);
        this.promoteTempCommit(mergeRef);
        this.unsyncedCommits.push(commit);
        break;
    }
    if (type !== 'temp') {
      this.addHead(this.nonTempHeadRefs, commit);
    }
  }

  private promoteTempCommit(ref?: string) {
    if (!ref) {
      return;
    }
    const commit = this.tempCommits.get(ref);
    if (commit) {
      const { baseRef, mergeRef } = asCommitRefs(commit);
      this.promoteTempCommit(baseRef);
      this.promoteTempCommit(mergeRef);
      this.addHead(this.nonTempHeadRefs, commit);
      this.tempCommits.delete(ref);
      this.unsyncedCommits.push(commit);
    }
    if (this.lastSavedDoc?.ref === ref) {
      this.lastNonTempDoc = this.lastSavedDoc;
    }
  }

  private updateCommitFromRemote(commit: Commit<CommitMetadata, Delta>) {
    const existingCommit = this.commits.get(commit.ref);
    if (!existingCommit) {
      return;
    }

    this.commits.set(commit.ref, {
      ...commit,
      metadata: mergeMetadata(
        existingCommit.metadata,
        commit.metadata,
      ) as CommitMetadata,
    });

    if (this.tempCommits.has(commit.ref)) {
      this.promoteTempCommit(commit.ref);
    }
  }

  private addNewCommit(
    newDoc: LatestDoc,
    metadata: CommitMetadata,
    temp: boolean,
    base: CommitDoc<SavedDoc, CommitMetadata> | undefined,
    mergeRef: string,
  ): string;
  private addNewCommit(
    newDoc: LatestDoc,
    metadata: CommitMetadata,
    temp: boolean,
    base?: CommitDoc<SavedDoc, CommitMetadata> | undefined,
    mergeRef?: string,
  ): string | undefined;
  private addNewCommit(
    newDoc: LatestDoc,
    metadata: CommitMetadata,
    temp: boolean,
    base: CommitDoc<SavedDoc, CommitMetadata> | undefined = this.lastSavedDoc,
    mergeRef?: string,
  ): string | undefined {
    const delta = this.differ.diff(base?.doc, newDoc);
    if (delta === undefined && mergeRef === undefined) {
      if (base) {
        this.docCache.set(base?.ref, { ...base, doc: newDoc });
      }
      return undefined;
    }
    const baseRef = base?.ref;
    const ref = this.computeRef(baseRef, mergeRef, delta);
    if (this.addNewCommitMetadata) {
      metadata = this.addNewCommitMetadata(
        metadata,
        ref,
        this.userId,
        this.clientId,
      );
    }

    // Use the client-provided doc to maintain structural sharing
    // for computing future diffs.
    this.docCache.set(ref, { doc: newDoc, ref, metadata });
    const commit: Commit<CommitMetadata, Delta> =
      mergeRef !== undefined
        ? { ref, baseRef, mergeRef, delta, metadata }
        : { ref, baseRef, delta, metadata };
    this.addCommit(commit, temp ? 'temp' : 'local');
    return ref;
  }

  public shutdown(): Promise<void> | void {
    return this.store.shutdown();
  }
}
