import { GetSyncBackendFn, TrimergeSyncBackend } from './TrimergeSyncBackend';

export class StoreSync<EditMetadata, Delta, CursorState> {
  private readonly localStore: TrimergeSyncBackend<
    EditMetadata,
    Delta,
    CursorState
  >;
  private readonly remoteStore: TrimergeSyncBackend<
    EditMetadata,
    Delta,
    CursorState
  >;
  constructor(
    userId: string,
    cursorId: string,
    getLocalStore: GetSyncBackendFn<EditMetadata, Delta, CursorState>,
    getRemoteStore: GetSyncBackendFn<EditMetadata, Delta, CursorState>,
  ) {
    this.localStore = getLocalStore(userId, cursorId, undefined, (event) => {
      this.remoteStore.broadcast(event);
    });
    this.remoteStore = getRemoteStore(userId, cursorId, undefined, (event) => {
      this.localStore.broadcast(event);
    });
  }
  async close() {
    await this.remoteStore.close();
    await this.localStore.close();
  }
}
