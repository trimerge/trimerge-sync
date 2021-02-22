import {
  CursorInfo,
  CursorRef,
  DiffNode,
  GetSyncBackendFn,
  OnEventFn,
  TrimergeSyncBackend,
} from './TrimergeSyncBackend';
import { mergeHeadNodes } from './merge-nodes';
import { Differ, NodeStateRef } from './differ';
import { getFullId, waitMs } from './util';

export class TrimergeClient<State, EditMetadata, Delta, CursorState> {
  private current?: NodeStateRef<State, EditMetadata>;
  private lastSyncId: string | undefined;

  private stateSubscribers = new Map<(state: State) => void, State>();
  private cursorsSubscribers = new Map<
    (cursors: readonly CursorInfo<CursorState>[]) => void,
    readonly CursorInfo<CursorState>[]
  >();

  private cursorMap = new Map<string, CursorInfo<CursorState>>();
  private cursorArray: readonly CursorInfo<CursorState>[] = [];

  private nodes = new Map<string, DiffNode<EditMetadata, Delta>>();
  private values = new Map<string, NodeStateRef<State, EditMetadata>>();
  private headRefs = new Set<string>();

  private backend: TrimergeSyncBackend<EditMetadata, Delta, CursorState>;
  private unsyncedNodes: DiffNode<EditMetadata, Delta>[] = [];

  private selfFullId: string;
  private newCursorState: CursorRef<CursorState> | undefined;

  constructor(
    readonly userId: string,
    readonly cursorId: string,
    private readonly getSyncBackend: GetSyncBackendFn<
      EditMetadata,
      Delta,
      CursorState
    >,
    private readonly differ: Differ<State, EditMetadata, Delta>,
    private readonly bufferMs: number = 100,
  ) {
    console.log('[TRIMERGE-SYNC] new TrimergeClient');
    this.selfFullId = getFullId(userId, cursorId);
    this.backend = getSyncBackend(userId, cursorId, undefined, this.onEvent);
  }

  private setCursor(cursor: CursorInfo<CursorState>) {
    const { userId, cursorId, ref, state } = cursor;
    this.cursorMap.set(getFullId(userId, cursorId), {
      userId,
      cursorId,
      ref,
      state,
      self: userId === this.userId && cursorId === this.cursorId,
    });
  }
  private onEvent: OnEventFn<EditMetadata, Delta, CursorState> = (event) => {
    console.log('[TRIMERGE-SYNC] got event', event);
    switch (event.type) {
      case 'nodes':
        for (const node of event.nodes) {
          this.addNode(node, false);
        }
        this.lastSyncId = event.syncId;

        this.mergeHeads();
        this.sync();
        break;

      case 'ack':
        this.lastSyncId = event.syncId;
        break;

      case 'cursors':
        for (const cursor of event.cursors) {
          this.setCursor(cursor);
        }
        this.emitCursorsChange();
        break;

      case 'cursor-leave': {
        this.cursorMap.delete(getFullId(event.userId, event.cursorId));
        this.emitCursorsChange();
        break;
      }

      case 'cursor-join': {
        this.setCursor(event);
        this.emitCursorsChange();
        break;
      }

      case 'error':
        break;

      default:
        console.warn(`unknown event: ${event['type']}`);
        break;
    }
  };

  get state(): State {
    return this.current ? this.current.value : this.differ.initialState;
  }
  get cursors(): readonly CursorInfo<CursorState>[] {
    return this.cursorArray;
  }

  subscribeState(onStateChange: (state: State) => void) {
    this.stateSubscribers.set(onStateChange, this.state);
    onStateChange(this.state);
    return () => {
      this.stateSubscribers.delete(onStateChange);
    };
  }

  subscribeCursors(
    onCursorsChange: (state: readonly CursorInfo<CursorState>[]) => void,
  ) {
    this.cursorsSubscribers.set(onCursorsChange, this.cursors);
    onCursorsChange(this.cursors);
    return () => {
      this.cursorsSubscribers.delete(onCursorsChange);
    };
  }

  updateState(
    value: State,
    editMetadata: EditMetadata,
    cursorState?: CursorState,
  ) {
    const ref = this.addNewNode(value, editMetadata);
    this.setCursorState(cursorState, ref);
    this.mergeHeads();
    this.emitStateChange();
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
    this.newCursorState = { ref, state };
    const { userId, cursorId, selfFullId } = this;
    this.cursorMap.set(selfFullId, {
      userId,
      cursorId,
      ref,
      state,
      self: true,
    });
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

  private emitStateChange() {
    const state = this.state;
    for (const [subscriber, lastState] of this.stateSubscribers.entries()) {
      if (lastState !== state) {
        subscriber(state);
        this.stateSubscribers.set(subscriber, state);
      }
    }
  }

  private emitCursorsChange() {
    this.cursorArray = Array.from(this.cursorMap.values());
    const cursors = this.cursorArray;
    for (const [subscriber, lastCursors] of this.cursorsSubscribers.entries()) {
      if (lastCursors !== cursors) {
        subscriber(cursors);
        this.cursorsSubscribers.set(subscriber, cursors);
      }
    }
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
    console.log(`[TRIMERGE-SYNC] TrimergeClient: shutdown`);
    return this.backend.close();
  }
}
