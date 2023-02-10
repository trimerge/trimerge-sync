import { getRefListComputeRef } from './refListComputeRef';

describe('refListComputeRef', () => {
  it('should return the next ref in the list', () => {
    const refList = ['a', 'b', 'c'];
    const computeRef = getRefListComputeRef(refList);
    expect(computeRef("don't care", "don't care", "don't care")).toEqual('a');
    expect(computeRef("don't care", "don't care", "don't care")).toEqual('b');
    expect(computeRef("don't care", "don't care", "don't care")).toEqual('c');
  });

  it('allow two different ref lists', () => {
    const computeRef1 = getRefListComputeRef(['a', 'b', 'c']);
    const computeRef2 = getRefListComputeRef(['x', 'y', 'z']);
    expect(computeRef1("don't care", "don't care", "don't care")).toEqual('a');
    expect(computeRef1("don't care", "don't care", "don't care")).toEqual('b');
    expect(computeRef1("don't care", "don't care", "don't care")).toEqual('c');

    expect(computeRef2("don't care", "don't care", "don't care")).toEqual('x');
    expect(computeRef2("don't care", "don't care", "don't care")).toEqual('y');
    expect(computeRef2("don't care", "don't care", "don't care")).toEqual('z');
  });
});
