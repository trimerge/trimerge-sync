// Copyright 2023 Descript, Inc
import {
  ClientInfo,
  ClientList,
  Commit,
  ErrorEventError,
  LocalClientInfo,
  LocalStore,
  Loggable,
  Logger,
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
import invariant from 'invariant';
import { PrefixLogger } from './lib/PrefixLogger';

const DIFF_PATCH_DURATION_WARNING_MS = 32;

type AddCommitType =
  // Added from this client
  | 'local'
  // Added from outside the client (e.g. a store)
  | 'external'
  // Added from this client, but don't sync to store
  | 'temp'
  // this is a synthetic commit that should not be synced to the store
  | 'reference';

export type SubscribeEvent = {
  origin:
    | 'subscribe' // We send an initial event when you first subscribe
    | 'self' // We send an event when you explicitly update the value
    | 'local' // Another client on the same store updated the value
    | 'remote'; // A remote client updated the value
};

export type TrimergeClientErrorType =
  | 'migrate' // occurred when migrating a doc to the latest version
  | 'merge-all-heads' // occurred when merging all head commits
  | 'local-store' // emitted by the local store
  | 'remote' // emitted by the remote store
  | 'add-commits'; // occurred when we tried to add commits

/** This error is emitted when TrimergeClient is unable to resolve the document at a particular commit. */
export class DocumentResolutionError extends Error {
  name = 'DocumentResolutionError';
}

export class UnknownRefError extends Error {
  name = 'UnknownRefError';
}

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
> implements Loggable
{
  // The doc for the latest non-temp commit
  // This is used when rolling back all temp commits
  private lastNonTempDocRef?: string;

  // The doc for the latest commit (potentially temp)
  private lastSavedDocRef?: string;

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
      a.remoteConnect === b.remoteConnect &&
      a.remoteCursor === b.remoteCursor,
  );
  private clientListSubs = new SubscriberList<
    ClientList<Presence>,
    SubscribeEvent
  >(() => this.clientList);

  private errorSubs: ((error: TrimergeClientError) => void)[] = [];

  private clientMap = new Map<string, LocalClientInfo<Presence>>();
  private clientList: ClientList<Presence> = [];

  private commits = new Map<string, Commit<CommitMetadata, Delta>>();

  /** This records a mapping of left and right commits to commit refs. */
  private mergeRefs = new Map<string, string>();
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

  /** The user-defined shutdown callback. */
  private readonly onShutdown: (() => void | Promise<void>) | undefined;
  private readonly docCache: DocCache<SavedDoc, CommitMetadata>;
  private tempCommits = new Map<string, Commit<CommitMetadata, Delta>>();
  private unsyncedCommits: Commit<CommitMetadata, Delta>[] = [];
  private logger: Logger | undefined;

  private newPresence: ClientInfo<Presence> | undefined;

  private numPendingUpdates: number = 0;

  private isShutdown = false;
  private readonly loggingPrefix;

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
      localStore,
      addNewCommitMetadata,
      docCache = new InMemoryDocCache(),
      shutdown: onShutdown,
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
    this.onShutdown = onShutdown;
    this.computeRef = computeRef;
    this.addNewCommitMetadata = addNewCommitMetadata;
    this.docCache = docCache;
    this.store = localStore;
    this.store.listen(this.onStoreEvent);
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

    this.loggingPrefix = `TRIMERGE_CLIENT:${this.clientId}`;
  }

  configureLogger(logger: Logger | undefined): void {
    if (logger) {
      this.logger = new PrefixLogger(this.loggingPrefix, logger);
    } else {
      this.logger = undefined;
    }
    this.store.configureLogger(logger);
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
    this.logger?.event?.({
      type: 'receive-event',
      sourceId: this.loggingPrefix,
      payload: {
        event,
      },
    });
    const origin = remoteOrigin ? 'remote' : 'local';

    switch (event.type) {
      case 'commits': {
        try {
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
        } catch (e) {
          this.emitError('add-commits', e);
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
        if (remoteOrigin && event.fatal && !event.reconnect) {
          this.emitError('remote', new ErrorEventError(event));
        } else if (event.code === 'internal') {
          this.emitError('local-store', new ErrorEventError(event));
          this.updateSyncState({ localRead: 'error' });
        }
        break;

      default:
        this.logger?.warn(`unknown event: ${event['type']}`);
        break;
    }
  };

  get lastSavedDoc(): CommitDoc<SavedDoc, CommitMetadata> | undefined {
    if (this.lastSavedDocRef === undefined) {
      return undefined;
    }
    return this.getCommitDoc(this.lastSavedDocRef);
  }

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
  ): Promise<string | undefined> {
    invariant(!this.isShutdown, 'attempting to update doc after shutdown');

    const ref = this.addNewCommit(doc, metadata, false);
    this.logger?.debug('updateDoc:', ref);
    this.setPresence(presence, ref);

    if (ref === undefined) {
      return this.lastSavedDoc?.ref;
    }

    this.mergeHeads();
    this.docSubs.emitChange({ origin: 'self' });
    await this.sync();
    return ref;
  }

  updatePresence(state: Presence) {
    invariant(!this.isShutdown, 'attempting to update presence after shutdown');
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
    throw new UnknownRefError(`unknown ref "${ref}"`);
  };

  getMerge = (leftRef: string, rightRef: string) => {
    return this.mergeRefs.get(`${leftRef}+${rightRef}`);
  };

  /** In some cases, temp work can get blown away because of the new commits from remote
   *  but we can reuse the merge commit. This method essentially "reapplies" the merge
   *  to the current resolution state.
   */
  reuseMerge = (ref: string) => {
    const mergeCommit = this.getCommit(ref);
    const { baseRef, mergeRef } = asCommitRefs(mergeCommit);
    if (!mergeRef || !baseRef) {
      throw new Error(`not a valid merge commit: ${ref}`);
    }

    this.tempCommits.set(mergeCommit.ref, mergeCommit);
    this.addHead(this.allHeadRefs, mergeCommit);
    const currentRef = this.lastSavedDocRef;
    if (!currentRef || currentRef === baseRef || currentRef === mergeRef) {
      this.lastSavedDocRef = mergeCommit.ref;
      this.latestDoc = undefined;
    }
    return mergeCommit.ref;
  };

  private mergeHelpers: MergeHelpers<LatestDoc, CommitMetadata> = {
    getCommitInfo: this.getCommit,
    getMergeRef: this.getMerge,
    computeLatestDoc: (ref) => this.migrateCommit(this.getCommitDoc(ref)),
    addMerge: (doc, metadata, temp, leftRef, rightRef, reference) =>
      this.addNewCommit(
        doc,
        metadata,
        temp,
        this.getCommitDoc(leftRef),
        rightRef,
        reference,
      ),
    reuseMerge: this.reuseMerge,
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
      const commit = this.commits.get(currentCommitRef);

      if (!commit) {
        throw new DocumentResolutionError(
          `Could not construct commit doc for ref ${headRef} because commit ${currentCommitRef} is missing`,
        );
      }
      commitWalk.push(commit);
      currentCommitRef = commit.baseRef;
    }

    // Iterate from the end of the commit walk to the beginning
    // computing the document as we go.
    for (let i = commitWalk.length - 1; i >= 0; i--) {
      const start = performance.now();
      const { ref, delta, metadata } = commitWalk[i];
      baseDoc = {
        ref,
        doc: this.differ.patch(baseDoc?.doc, delta),
        metadata,
      };
      this.docCache.set(ref, baseDoc);
      const end = performance.now();
      if (end - start > DIFF_PATCH_DURATION_WARNING_MS) {
        this.logger?.warn(`Slow patch ${ref} took ${Math.ceil(end - start)}ms`);
      }
    }

    // I don't believe this can actually happen but couldn't
    // get the types to work out.
    if (!baseDoc) {
      throw new DocumentResolutionError(
        `Could not construct commit doc for ref ${headRef}`,
      );
    }

    return baseDoc;
  }

  private migrateCommit(
    commit: CommitDoc<SavedDoc, CommitMetadata>,
  ): CommitDoc<LatestDoc, CommitMetadata> {
    try {
      const { doc, metadata } = this.migrate(commit.doc, commit.metadata);
      if (commit.doc === doc) {
        return commit as CommitDoc<LatestDoc, CommitMetadata>;
      }
      const ref = this.addNewCommit(doc, metadata, true, commit);
      if (ref === undefined) {
        return commit as CommitDoc<LatestDoc, CommitMetadata>;
      }
      return { ref, doc, metadata };
    } catch (e) {
      this.emitError('migrate', e);
      throw e;
    }
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

  private emitError(type: TrimergeClientErrorType, cause: unknown) {
    const wrappedCause =
      cause instanceof Error ? cause : new Error(String(cause));
    for (const onError of this.errorSubs) {
      onError(new TrimergeClientError(type, wrappedCause));
    }
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
        this.logger?.event?.({
          type: 'update-store',
          sourceId: this.loggingPrefix,
          payload: {
            commits,
          },
        });
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
        throw new DocumentResolutionError(
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
        this.logger?.warn(
          `skipping add commit ${ref}, base ${baseRef}, merge ${mergeRef} (type=${type})`,
        );
      }
      return;
    }

    if (type === 'external') {
      // Roll back to non-temp commit
      if (this.lastSavedDocRef !== this.lastNonTempDocRef) {
        this.lastSavedDocRef = this.lastNonTempDocRef;
        this.latestDoc = undefined;
      }
      // Remove all temp commits
      for (const ref1 of this.tempCommits.keys()) {
        this.docCache.delete(ref1);
      }
      // Roll back heads
      this.allHeadRefs = new Set(this.nonTempHeadRefs);
      this.tempCommits.clear();
    }

    this.commits.set(ref, commit);
    if (mergeRef !== undefined) {
      this.mergeRefs.set(`${baseRef}+${mergeRef}`, ref);
    }
    // reference commits are never heads
    if (type !== 'reference') {
      this.addHead(this.allHeadRefs, commit);
    }
    const currentRef = this.lastSavedDocRef;
    if (!currentRef || currentRef === baseRef || currentRef === mergeRef) {
      this.lastSavedDocRef = commit.ref;
      if (type !== 'temp') {
        this.lastNonTempDocRef = this.lastSavedDocRef;
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
    if (type !== 'temp' && type !== 'reference') {
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
    if (this.lastSavedDocRef === ref) {
      this.lastNonTempDocRef = this.lastSavedDocRef;
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
    reference?: boolean,
  ): string;
  private addNewCommit(
    newDoc: LatestDoc,
    metadata: CommitMetadata,
    temp: boolean,
    base?: CommitDoc<SavedDoc, CommitMetadata> | undefined,
    mergeRef?: string,
    reference?: boolean,
  ): string | undefined;
  private addNewCommit(
    newDoc: LatestDoc,
    metadata: CommitMetadata,
    temp: boolean,
    base: CommitDoc<SavedDoc, CommitMetadata> | undefined = this.lastSavedDoc,
    mergeRef?: string,
    reference: boolean = false,
  ): string | undefined {
    const start = performance.now();
    const delta = this.differ.diff(base?.doc, newDoc);
    const end = performance.now();

    if (delta === undefined && mergeRef === undefined) {
      if (base) {
        this.docCache.set(base?.ref, { ...base, doc: newDoc });
      }
      return undefined;
    }
    const baseRef = base?.ref;
    const ref = this.computeRef(baseRef, mergeRef, delta);
    if (end - start > DIFF_PATCH_DURATION_WARNING_MS) {
      this.logger?.warn(`Slow diff ${ref} took ${Math.ceil(end - start)}ms`);
    }
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
    this.addCommit(commit, reference ? 'reference' : temp ? 'temp' : 'local');
    return ref;
  }

  public async shutdown(): Promise<void> {
    this.logger?.debug('requested shutdown');
    invariant(!this.isShutdown, 'already shutdown');
    this.isShutdown = true;

    const storeShutdownPromise = this.store.shutdown();
    if (storeShutdownPromise) {
      await storeShutdownPromise;
    }

    const shutdownCallbackPromise = this.onShutdown?.();
    if (shutdownCallbackPromise) {
      await shutdownCallbackPromise;
    }
  }
}
