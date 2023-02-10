import { ComputeRefFn } from '../TrimergeClientOptions';

type RefListComputeRefFn<Delta> = ComputeRefFn<Delta> & {
  refList: string[];
  refIndex: number;
};

/** RefListComputeRef is a simple implementation of compute ref which just generates
 *  commit refs sequentially from a list of refs. This is just for testing purposes.
 */
export function getRefListComputeRef<Delta>(
  refList: string[],
): ComputeRefFn<Delta> {
  const refListComputeRef = function (this: RefListComputeRefFn<Delta>) {
    if (this.refIndex >= this.refList.length) {
      throw new Error(
        `out of bounds: ${this.refIndex}, but ref list only had ${this.refList.length} elements`,
      );
    }
    const result = this.refList[this.refIndex];
    this.refIndex = this.refIndex + 1;
    return result;
  };
  refListComputeRef.refList = refList;
  refListComputeRef.refIndex = 0;
  return refListComputeRef.bind(refListComputeRef);
}
