import {
  ClientInfo,
  ClientList,
  LocalClientInfo,
  DiffNode,
  GetLocalStoreFn,
  LocalStore,
  OnEventFn,
  SyncStatus,
} from './types';
import { mergeHeadNodes } from './merge-nodes';
import { Differ, NodeStateRef } from './differ';
import { getFullId, waitMs } from './util';
import { OnChangeFn, SubscriberList } from './lib/SubscriberList';

export class TrimergeClient<State, EditMetadata, Delta, PresenceState> {
  private current?: NodeStateRef<State, EditMetadata>;
  private lastSyncId: string | undefined;

  private stateSubs = new SubscriberList(() => this.state);
  private syncStateSubs = new SubscriberList(() => this.syncState);
  private clientListSubs = new SubscriberList(() => this.clientList);

  private clientMap = new Map<string, LocalClientInfo<PresenceState>>();
  private clientList: ClientList<PresenceState> = [];

  private nodes = new Map<string, DiffNode<EditMetadata, Delta>>();
  private values = new Map<string, NodeStateRef<State, EditMetadata>>();
  private headRefs = new Set<string>();

  private store: LocalStore<EditMetadata, Delta, PresenceState>;
  private unsyncedNodes: DiffNode<EditMetadata, Delta>[] = [];

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
    private readonly differ: Differ<State, EditMetadata, Delta>,
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

  private setClientInfo(cursor: LocalClientInfo<PresenceState>) {
    const { userId, clientId } = cursor;
    this.clientMap.set(getFullId(userId, clientId), cursor);
    this.emitClientListChange();
  }
  private onEvent: OnEventFn<EditMetadata, Delta, PresenceState> = (event) => {
    switch (event.type) {
      case 'nodes': {
        const { nodes, syncId, clientInfo } = event;
        for (const node of nodes) {
          this.addNode(node, false);
        }
        this.lastSyncId = syncId;
        this.mergeHeads();
        this.stateSubs.emitChange();
        this.sync();
        if (clientInfo) {
          this.setClientInfo(clientInfo);
        }

        break;
      }

      case 'ack':
        this.lastSyncId = event.syncId;
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
    return this.current?.value;
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
    const ref = this.addNewNode(value, editMetadata);
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
    ref = this.current?.ref,
  ) {
    const { userId, clientId } = this;
    this.newPresenceState = { userId, clientId, ref, state };
    this.setClientInfo({ userId, clientId, ref, state, self: true });
    this.emitClientListChange();
  }

  getNodeState(ref: string): NodeStateRef<State, EditMetadata> {
    const value = this.values.get(ref);
    if (value !== undefined) {
      return value;
    }
    const node = this.getNode(ref);
    const baseValue = node.baseRef
      ? this.getNodeState(node.baseRef).value
      : undefined;
    const valueState: NodeStateRef<State, EditMetadata> = {
      ref: node.ref,
      value: this.differ.patch(baseValue, node.delta),
      editMetadata: node.editMetadata,
    };
    this.values.set(ref, valueState);
    return valueState;
  }

  getNode = (ref: string) => {
    const node = this.nodes.get(ref);
    if (node) {
      return node;
    }
    throw new Error(`unknown node ref "${ref}"`);
  };

  private mergeHeads() {
    if (this.headRefs.size <= 1) {
      return;
    }
    mergeHeadNodes(
      Array.from(this.headRefs),
      this.getNode,
      (baseRef, leftRef, rightRef) => {
        const base =
          baseRef !== undefined ? this.getNodeState(baseRef) : undefined;
        const left = this.getNodeState(leftRef);
        const right = this.getNodeState(rightRef);
        // TODO: we likely need to normalize left/right
        const { value, editMetadata } = this.differ.merge(base, left, right);
        return this.addNewNode(value, editMetadata, left, rightRef, baseRef);
      },
    );
    // TODO: update PresenceState(s) based on this merge
    // TODO: can we clear out nodes we don't need anymore?
  }

  private syncPromise: Promise<boolean> | undefined;

  private emitClientListChange() {
    this.clientList = Array.from(this.clientMap.values());
    this.clientListSubs.emitChange();
  }

  private get needsSync(): boolean {
    return this.unsyncedNodes.length > 0 || this.newPresenceState !== undefined;
  }
  sync(): Promise<boolean> | undefined {
    if (!this.syncPromise && this.needsSync) {
      this.syncPromise = this.doSync();
    }
    return this.syncPromise;
  }

  private updateSyncState(update: Partial<SyncStatus>) {
    this.syncState = { ...this.syncState, ...update };
    this.syncStateSubs.emitChange();
  }

  private async doSync() {
    while (this.needsSync) {
      this.updateSyncState({ localSave: 'pending' });
      await waitMs(this.bufferMs);
      const nodes = this.unsyncedNodes;
      this.unsyncedNodes = [];
      this.updateSyncState({ localSave: 'saving' });
      this.store.update(nodes, this.newPresenceState);
      this.newPresenceState = undefined;
    }
    this.updateSyncState({ localSave: 'ready' });
    this.syncPromise = undefined;
    return true;
  }

  private addNode(node: DiffNode<EditMetadata, Delta>, local: boolean): void {
    const { ref, baseRef, mergeRef } = node;
    this.nodes.set(ref, node);
    if (baseRef !== undefined) {
      this.headRefs.delete(baseRef);
    }
    if (mergeRef !== undefined) {
      this.headRefs.delete(mergeRef);
    }
    this.headRefs.add(ref);
    const currentRef = this.current?.ref;
    if (currentRef === node.baseRef || currentRef === node.mergeRef) {
      this.current = this.getNodeState(node.ref);
    }
    if (local) {
      this.unsyncedNodes.push(node);
    }
  }

  private addNewNode(
    value: State,
    editMetadata: EditMetadata,
    base: NodeStateRef<State, EditMetadata> | undefined = this.current,
    mergeRef?: string,
    mergeBaseRef?: string,
  ): string {
    const { userId, clientId } = this;
    const delta = this.differ.diff(base?.value, value);
    const baseRef = base?.ref;
    const ref = this.differ.computeRef(baseRef, mergeRef, delta, editMetadata);
    const diffNode: DiffNode<EditMetadata, Delta> = {
      userId,
      clientId,
      ref,
      baseRef,
      mergeRef,
      mergeBaseRef,
      delta,
      editMetadata,
    };
    this.addNode(diffNode, true);
    return ref;
  }

  public shutdown(): Promise<void> | void {
    return this.store.shutdown();
  }
}
