import {
  CursorInfo,
  CursorInfos,
  DiffNode,
  GetLocalBackendFn,
  LocalBackend,
  OnEventFn,
  SyncState,
} from './types';
import { mergeHeadNodes } from './merge-nodes';
import { Differ, NodeStateRef } from './differ';
import { getFullId, waitMs } from './util';
import { OnChangeFn, SubscriberList } from './lib/SubscriberList';

export class TrimergeClient<State, EditMetadata, Delta, CursorState> {
  private current?: NodeStateRef<State, EditMetadata>;
  private lastSyncId: string | undefined;

  private stateSubs = new SubscriberList(() => this.state);
  private syncStateSubs = new SubscriberList(() => this.syncState);
  private cursorsSubs = new SubscriberList(() => this.cursorArray);

  private cursorMap = new Map<string, CursorInfo<CursorState>>();
  private cursorArray: CursorInfos<CursorState> = [];

  private nodes = new Map<string, DiffNode<EditMetadata, Delta>>();
  private values = new Map<string, NodeStateRef<State, EditMetadata>>();
  private headRefs = new Set<string>();

  private backend: LocalBackend<EditMetadata, Delta, CursorState>;
  private unsyncedNodes: DiffNode<EditMetadata, Delta>[] = [];

  private selfFullId: string;
  private newCursorState: CursorInfo<CursorState> | undefined;

  private syncState: SyncState = {
    localRead: 'loading',
    localSave: 'ready',
    remoteConnect: 'offline',
    remoteRead: 'offline',
    remoteSave: 'ready',
  };

  constructor(
    readonly userId: string,
    readonly cursorId: string,
    private readonly getLocalBackend: GetLocalBackendFn<
      EditMetadata,
      Delta,
      CursorState
    >,
    private readonly differ: Differ<State, EditMetadata, Delta>,
    private readonly bufferMs: number = 0,
  ) {
    this.selfFullId = getFullId(userId, cursorId);
    this.backend = getLocalBackend(userId, cursorId, this.onEvent);
    this.setCursor({
      userId,
      cursorId,
      ref: undefined,
      state: undefined,
      origin: 'self',
    });
  }

  private setCursor(cursor: CursorInfo<CursorState>) {
    const { userId, cursorId } = cursor;
    this.cursorMap.set(getFullId(userId, cursorId), cursor);
    this.emitCursorsChange();
  }
  private onEvent: OnEventFn<EditMetadata, Delta, CursorState> = (event) => {
    switch (event.type) {
      case 'nodes': {
        const { nodes, syncId, cursor } = event;
        for (const node of nodes) {
          this.addNode(node, false);
        }
        this.lastSyncId = syncId;
        this.mergeHeads();
        this.stateSubs.emitChange();
        this.sync();
        if (cursor) {
          this.setCursor(cursor);
        }

        break;
      }

      case 'ack':
        this.lastSyncId = event.syncId;
        break;

      case 'cursor-leave':
        this.cursorMap.delete(getFullId(event.userId, event.cursorId));
        this.emitCursorsChange();
        break;

      case 'cursor-join':
      case 'cursor-update':
      case 'cursor-here':
        this.setCursor(event.cursor);
        break;

      case 'remote-state':
        for (const [key, { origin }] of this.cursorMap.entries()) {
          if (origin === 'remote') {
            this.cursorMap.delete(key);
          }
        }
        this.emitCursorsChange();
        break;

      case 'ready':
        break;
      case 'error':
        break;

      default:
        console.warn(`unknown event: ${event['type']}`);
        break;
    }
  };

  get state(): State | undefined {
    return this.current?.value;
  }
  get cursors(): CursorInfos<CursorState> {
    return this.cursorArray;
  }

  subscribeState(onChange: OnChangeFn<State | undefined>) {
    return this.stateSubs.subscribe(onChange);
  }

  subscribeSyncState(onChange: OnChangeFn<SyncState>) {
    return this.syncStateSubs.subscribe(onChange);
  }

  subscribeCursors(onChange: OnChangeFn<CursorInfos<CursorState>>) {
    return this.cursorsSubs.subscribe(onChange);
  }

  updateState(
    value: State,
    editMetadata: EditMetadata,
    cursorState?: CursorState,
  ) {
    const ref = this.addNewNode(value, editMetadata);
    this.setCursorState(cursorState, ref);
    this.mergeHeads();
    this.stateSubs.emitChange();
    this.sync();
  }

  updateCursor(state: CursorState) {
    this.setCursorState(state);
    this.sync();
  }

  private setCursorState(
    state: CursorState | undefined,
    ref = this.current?.ref,
  ) {
    const { userId, cursorId } = this;
    this.newCursorState = { userId, cursorId, ref, state, origin: 'self' };
    this.setCursor(this.newCursorState);
    this.emitCursorsChange();
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
    // TODO: update CursorState(s) based on this merge
    // TODO: can we clear out nodes we don't need anymore?
  }

  private syncPromise: Promise<boolean> | undefined;

  private emitCursorsChange() {
    this.cursorArray = Array.from(this.cursorMap.values());
    this.cursorsSubs.emitChange();
  }

  private get needsSync(): boolean {
    return this.unsyncedNodes.length > 0 || this.newCursorState !== undefined;
  }
  sync(): Promise<boolean> | undefined {
    if (!this.syncPromise && this.needsSync) {
      this.syncPromise = this.doSync();
    }
    return this.syncPromise;
  }
  private async doSync() {
    while (this.needsSync) {
      await waitMs(this.bufferMs);
      const nodes = this.unsyncedNodes;
      this.unsyncedNodes = [];
      this.backend.update(nodes, this.newCursorState);
      this.newCursorState = undefined;
    }
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
    const { userId, cursorId } = this;
    const delta = this.differ.diff(base?.value, value);
    const baseRef = base?.ref;
    const ref = this.differ.computeRef(baseRef, mergeRef, delta, editMetadata);
    const diffNode: DiffNode<EditMetadata, Delta> = {
      userId,
      cursorId,
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
    return this.backend.shutdown();
  }
}
