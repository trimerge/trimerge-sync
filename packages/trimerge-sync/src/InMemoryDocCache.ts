import { CommitDoc, DocCache } from './TrimergeClientOptions';

/** Simple implementation that just wraps a Map. */
export class InMemoryDocCache<SavedDoc, CommitMetadata>
  implements DocCache<SavedDoc, CommitMetadata>
{
  private readonly docs: Map<string, CommitDoc<SavedDoc, CommitMetadata>> =
    new Map();
  get(ref: string) {
    return this.docs.get(ref);
  }
  set(ref: string, doc: CommitDoc<SavedDoc, CommitMetadata>) {
    this.docs.set(ref, doc);
  }
  has(ref: string) {
    return this.docs.has(ref);
  }
  delete(ref: string) {
    this.docs.delete(ref);
  }
}
