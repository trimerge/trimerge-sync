import { BroadcastEvent, EventChannel } from 'trimerge-sync';

/** This creates a native browser BroadcastChannel implementation of EventChannel */
function getBroadcastChannelEventChannel<CommitMetadata, Delta, Presence>(
  docId: string,
): EventChannel<CommitMetadata, Delta, Presence> {
  let channel: BroadcastChannel | undefined = new BroadcastChannel(docId);
  const eventListenerCallbacks: ((e: MessageEvent) => void)[] = [];

  return {
    onEvent: (
      cb: (ev: BroadcastEvent<CommitMetadata, Delta, Presence>) => void,
    ) => {
      if (!channel) {
        throw new Error(
          'attempting to register an event callback after channel has been shutdown',
        );
      }

      const newCb = (e: MessageEvent) => cb(e.data);
      eventListenerCallbacks.push(newCb);
      return channel?.addEventListener('message', newCb);
    },
    sendEvent: (ev: BroadcastEvent<CommitMetadata, Delta, Presence>) => {
      if (!channel) {
        throw new Error(
          `attempting to send an event after channel has been shutdown ${ev}`,
        );
      }
      return channel?.postMessage(ev);
    },
    shutdown: () => {
      for (const cb of eventListenerCallbacks) {
        channel?.removeEventListener('message', cb);
      }
      channel?.close();
      channel = undefined;
    },
  };
}
