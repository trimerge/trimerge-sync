import {
  ClientInfo,
  ClientList,
  Commit,
  ErrorEventError,
  EditCommit,
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
  MergeDocFn,
  MigrateDocFn,
  TrimergeClientOptions,
} from './TrimergeClientOptions';
import { getFullId } from './util';
import { OnChangeFn, SubscriberList } from './lib/SubscriberList';
import { asCommitRefs } from './lib/Commits';
import { mergeMetadata } from './lib/mergeMetadata';
import { InMemoryDocCache } from './InMemoryDocCache';
import Branch from './Branch';
import { MergeCommit } from './types';

type AddCommitType =
  // Added from this client
  | 'local'
  // Added from outside the client (e.g. a store)
  | 'external'
  // Added from this client, but don't sync to store
  | 'temp'
  | 'self';

export type SubscribeEvent = {
  origin:
    | 'subscribe' // We send an initial event when you first subscribe
    | 'self' // We send an event when you explicitly update the value
    | 'local' // Another client on the same store updated the value
    | 'remote'; // A remote client updated the value
};

export type TrimergeClientErrorType =
  | 'migrate'
  | 'merge-all-heads'
  | 'local-store'
  | 'remote';

export class TrimergeClientError extends Error {
  name = 'TrimergeClientError';
  constructor(readonly type: TrimergeClientErrorType, readonly cause: Error) {
    super();
  }
}

export class TrimergeClient<
  SavedDoc,
  LatestDoc extends SavedDoc,
  CommitMetadata,
  Delta,
  Presence,
> {
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

  private errorSubs: ((error: TrimergeClientError) => void)[] = [];

  private clientMap = new Map<string, LocalClientInfo<Presence>>();
  private clientList: ClientList<Presence> = [];

  private commits = new Map<string, Commit<CommitMetadata, Delta>>();
  private branch = new Branch<CommitMetadata, Delta>();
  private mainHead: string | undefined;
  private pendingMerge: string | undefined;

  private store: LocalStore<CommitMetadata, Delta, Presence>;
  private readonly differ: Differ<SavedDoc, Delta>;
  private readonly migrate: MigrateDocFn<SavedDoc, LatestDoc, CommitMetadata>;
  private readonly merge: MergeDocFn<LatestDoc, CommitMetadata>;
  private readonly computeRef: ComputeRefFn<Delta>;
  private readonly addNewCommitMetadata:
    | AddNewCommitMetadataFn<CommitMetadata>
    | undefined;
  private readonly docCache: DocCache<SavedDoc, CommitMetadata>;
  private unsyncedCommits: Commit<CommitMetadata, Delta>[] = [];
  private unsyncedMerge: Commit<CommitMetadata, Delta> | undefined;
  private unsyncedMergeLog: string | undefined;

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
      merge,
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
    this.merge = merge;
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
          // TODO: remote should not send any commits that aren't main
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          if (commit.metadata.server?.main) {
            this.addCommit(commit, remoteOrigin ? 'external' : 'self');
            this.mainHead = commit.ref;
          }
          // TODO: how to reset this if remote doesn't send back 'rejected' merge
          if (commit.ref === this.pendingMerge) {
            console.log(
              `BRANCH(${this.branch.size}) - merge clear ${commit.ref}`,
            );
            this.pendingMerge = undefined;
          }
        }
        if (this.branch.needsMerge()) {
          this.attemptMerge();
        }
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
          this.emitError(
            remoteOrigin ? 'remote' : 'local-store',
            new ErrorEventError(event),
          );
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
      this.latestDoc = this.migrateDocument(this.lastSavedDoc);
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

  subscribeError(onError: (error: TrimergeClientError) => void) {
    this.errorSubs.push(onError);
    return () => {
      this.errorSubs = this.errorSubs.filter((e) => e !== onError);
    };
  }

  async updateDoc(
    doc: LatestDoc,
    metadata: CommitMetadata,
    presence?: Presence,
  ): Promise<void> {
    const commit = this.generateCommit(doc, metadata);
    this.setPresence(presence, commit?.ref);
    if (commit !== undefined) {
      this.addCommit(commit, 'local');
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

  getCommitDoc(headRef: string): CommitDoc<SavedDoc, CommitMetadata> {
    // This is an iterative implementation of:
    //  const baseValue = baseRef ? this.getCommitDoc(baseRef).doc : undefined;

    // Build up the list of commits by walking the baseRef's back to the root
    // keeping track of the commits that you see along the way.
    let baseDoc: CommitDoc<SavedDoc, CommitMetadata> | undefined;
    const commitWalk: Commit<CommitMetadata, Delta>[] = [];
    let currentCommitRef: string | undefined = headRef;
    while (!baseDoc && currentCommitRef !== undefined) {
      // If we've already computed this document, short circuit
      // and start building up the document from there.
      if (this.docCache.has(currentCommitRef)) {
        baseDoc = this.docCache.get(currentCommitRef);
        break;
      }

      // otherwise, add the commit to the commit walk.
      const commit = this.getCommit(currentCommitRef);
      commitWalk.push(commit);
      currentCommitRef = commit.baseRef;
    }

    // Iterate from the end of the commit walk to the beginning
    // computing the document as we go.
    for (let i = commitWalk.length - 1; i >= 0; i--) {
      const { ref, delta, metadata } = commitWalk[i];
      baseDoc = {
        ref,
        doc: this.differ.patch(baseDoc?.doc, delta),
        metadata,
      };
      this.docCache.set(ref, baseDoc);
    }

    // I don't believe this can actually happen but couldn't
    // get the types to work out.
    if (!baseDoc) {
      throw new Error(`Could not construct commit doc for ref ${headRef}`);
    }

    return baseDoc;
  }

  private migrateDocument(
    document: CommitDoc<SavedDoc, CommitMetadata>,
  ): CommitDoc<LatestDoc, CommitMetadata> {
    const { doc: migratedDoc, metadata } = this.migrate(
      document.doc,
      document.metadata,
    );
    if (document.doc === migratedDoc) {
      return document as CommitDoc<LatestDoc, CommitMetadata>;
    }
    const commit = this.generateCommit(migratedDoc, metadata, document);
    if (commit === undefined) {
      return document as CommitDoc<LatestDoc, CommitMetadata>;
    }
    this.addCommit(commit, 'temp');
    return { ref: commit.ref, doc: migratedDoc, metadata };
  }

  private emitClientListChange(event: SubscribeEvent) {
    this.clientList = Array.from(this.clientMap.values());
    this.clientListSubs.emitChange(event);
  }

  private emitError(type: TrimergeClientErrorType, cause: unknown) {
    const wrappedCause =
      cause instanceof Error ? cause : new Error(String(cause));
    for (const onError of this.errorSubs) {
      onError(new TrimergeClientError(type, wrappedCause));
    }
  }

  private async sync(): Promise<void> {
    const commits = this.unsyncedCommits;
    if (this.pendingMerge === undefined && this.unsyncedMerge !== undefined) {
      this.pendingMerge = this.unsyncedMerge.ref;
      commits.push(this.unsyncedMerge);
      this.unsyncedMerge = undefined;
      console.log(`BRANCH(${this.branch.size}) - ${this.unsyncedMergeLog}`);
    }
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
        this.emitError('local-store', err);
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
        return;
      }
    }

    this.commits.set(ref, commit);

    if (type === 'external') {
      const updateHead = this.branch.advanceMain(commit);
      if (updateHead) {
        const head = this.branch.head;
        if (head === undefined) throw new Error('impossible update to origin');
        this.lastSavedDoc = this.getCommitDoc(head.ref);
        this.latestDoc = undefined;
      }
      console.log(`BRANCH(${this.branch.size}) - poke ${commit.ref}`);
    } else {
      if (type === 'self') {
        this.branch.checkout(commit);
        console.log(`BRANCH(${this.branch.size}) - checkout ${commit.ref}`);
      } else {
        const needsSync = this.branch.advanceBranch(commit, type === 'temp');
        this.unsyncedCommits.push(...needsSync);
        console.log(`BRANCH(${this.branch.size}) - edit ${commit.ref}`);
      }

      const currentRef = this.lastSavedDoc?.ref;
      if (!currentRef || currentRef === baseRef || currentRef === mergeRef) {
        this.lastSavedDoc = this.getCommitDoc(commit.ref);
        this.latestDoc = undefined;
      }
    }
  }

  private attemptMerge(): void {
    if (this.mainHead === undefined || this.branch.mergeHead === undefined) {
      throw new Error('no merge ready');
    }
    if (this.pendingMerge !== undefined) {
      // only one commit at a time
      return;
    }
    // TODO: casting here might not be a valid assumption
    const base = this.branch.mergeRoot
      ? (this.getCommitDoc(this.branch.mergeRoot.ref) as CommitDoc<
          LatestDoc,
          CommitMetadata
        >)
      : undefined;
    const left = this.getCommitDoc(this.mainHead) as CommitDoc<
      LatestDoc,
      CommitMetadata
    >;
    const right = this.getCommitDoc(this.branch.mergeHead.ref) as CommitDoc<
      LatestDoc,
      CommitMetadata
    >;
    const merge = this.merge(base, left, right);
    const commit = this.generateCommit(
      merge.doc,
      merge.metadata,
      left,
      right.ref,
    );
    this.branch.attemptMerge(commit);
    this.unsyncedMerge = commit;
    this.unsyncedMergeLog = `merge attempt ${commit.ref} = m:${this.mainHead} e:${this.branch.mergeHead.ref}`;
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
  }

  private generateCommit(
    newDoc: LatestDoc,
    metadata: CommitMetadata,
    base: CommitDoc<SavedDoc, CommitMetadata> | undefined,
    mergeRef: string,
  ): MergeCommit<CommitMetadata, Delta>;
  private generateCommit(
    newDoc: LatestDoc,
    metadata: CommitMetadata,
    base?: CommitDoc<SavedDoc, CommitMetadata> | undefined,
  ): EditCommit<CommitMetadata, Delta> | undefined;
  private generateCommit(
    newDoc: LatestDoc,
    metadata: CommitMetadata,
    base: CommitDoc<SavedDoc, CommitMetadata> | undefined = this.lastSavedDoc,
    mergeRef?: string,
  ): Commit<CommitMetadata, Delta> | undefined {
    const delta = this.differ.diff(base?.doc, newDoc);
    if (delta === undefined) {
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
    return { ref, baseRef, mergeRef, delta, metadata };
  }

  public shutdown(): Promise<void> | void {
    return this.store.shutdown();
  }
}
