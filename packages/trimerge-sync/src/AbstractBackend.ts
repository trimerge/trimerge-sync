import {
  BackendEvent,
  OnEventFn,
  TrimergeSyncBackend2,
  UnsubscribeFn,
} from './TrimergeSyncBackend';

export abstract class AbstractBackend<EditMetadata, Delta, CursorState>
  implements TrimergeSyncBackend2<EditMetadata, Delta, CursorState> {
  private listeners = new Set<OnEventFn<EditMetadata, Delta, CursorState>>();

  protected handle(event: BackendEvent<EditMetadata, Delta, CursorState>) {
    switch (event.type) {
      case 'nodes':
        break;
      case 'ready':
        break;
      case 'ack':
        break;
      case 'cursors':
        break;
      case 'cursor-join':
        break;
      case 'cursor-leave':
        break;
      case 'error':
        break;
    }
  }

  send(event: BackendEvent<EditMetadata, Delta, CursorState>): void {}
  subscribe(
    onEvent: OnEventFn<EditMetadata, Delta, CursorState>,
  ): UnsubscribeFn {
    if (this.listeners.has(onEvent)) {
      throw new Error('listener already subscribed');
    }
    this.listeners.add(onEvent);
    return () => {
      this.listeners.delete(onEvent);
    };
  }
}
