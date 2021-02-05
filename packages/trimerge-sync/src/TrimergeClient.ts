import {
  DiffNode,
  GetSyncBackendFn,
  OnEventFn,
  TrimergeSyncBackend,
} from './TrimergeSyncBackend';
import { mergeHeadNodes } from './merge-nodes';
import { Differ, NodeState } from './differ';

function waitMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type NodeStateRef<State, EditMetadata> = NodeState<
  State,
  EditMetadata
> & {
  ref: string;
};

export class TrimergeClient<State, EditMetadata, Delta, CursorData> {
  private current?: NodeStateRef<State, EditMetadata>;
  private lastSyncId: string | undefined;

  private stateSubscribers = new Map<
    (state: State | undefined) => void,
    State | undefined
  >();

  private nodes = new Map<string, DiffNode<EditMetadata, Delta>>();
  private values = new Map<string, NodeStateRef<State, EditMetadata>>();
  private headRefs = new Set<string>();

  private backend: TrimergeSyncBackend<EditMetadata, Delta, CursorData>;
  private unsyncedNodes: DiffNode<EditMetadata, Delta>[] = [];

  constructor(
    readonly userId: string,
    readonly cursorId: string,
    private readonly getSyncBackend: GetSyncBackendFn<
      EditMetadata,
      Delta,
      CursorData
    >,
    private readonly differ: Differ<State, EditMetadata, Delta>,
    private readonly bufferMs: number = 100,
  ) {
    this.backend = getSyncBackend(userId, cursorId, undefined, this.onEvent);
    this.normalize();
  }

  private onEvent: OnEventFn<EditMetadata, Delta, CursorData> = (event) => {
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
        break;
      case 'cursor-join':
        break;
      case 'cursor-update':
        break;
      case 'cursor-leave':
        break;
      case 'error':
        break;

      default:
        console.warn(`unknown event: ${event['type']}`);
        break;
    }
  };

  private normalize() {
    const currentValue = this.current?.value;
    const [normalized, editMetadata] = this.differ.normalize(currentValue);
    if (this.current === undefined || normalized !== currentValue) {
      this.addEdit(normalized, editMetadata, false);
    }
  }

  get state(): State | undefined {
    return this.current?.value;
  }

  subscribe(onStateChange: (state: State | undefined) => void) {
    this.stateSubscribers.set(onStateChange, this.state);
    onStateChange(this.state);
    return () => {
      this.stateSubscribers.delete(onStateChange);
    };
  }

  addEdit(value: State, editMetadata: EditMetadata, sync: boolean = true) {
    this.addNewNode(value, editMetadata);
    this.mergeHeads();
    if (sync) {
      this.sync();
    }
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
    const valueState = {
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
        return this.addNewNode(value, editMetadata, left, rightRef);
      },
    );
    // TODO: can we clear out nodes we don't need anymore?
  }

  private syncPromise: Promise<boolean> | undefined;

  sync(): Promise<boolean> | undefined {
    const state = this.state;
    for (const [subscriber, lastState] of this.stateSubscribers.entries()) {
      if (lastState !== state) {
        subscriber(state);
        this.stateSubscribers.set(subscriber, state);
      }
    }
    if (!this.syncPromise && this.unsyncedNodes.length > 0) {
      this.syncPromise = this.doSync();
    }
    return this.syncPromise;
  }
  private async doSync() {
    while (this.unsyncedNodes.length > 0) {
      await waitMs(this.bufferMs);
      const nodes = this.unsyncedNodes;
      this.unsyncedNodes = [];
      this.backend.sendNodes(nodes);
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
      delta,
      editMetadata,
    };
    this.addNode(diffNode, true);
    return ref;
  }

  public shutdown(): Promise<void> {
    return this.backend.close();
  }
}
