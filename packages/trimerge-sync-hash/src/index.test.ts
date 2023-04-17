import { computeRef } from './index';

describe('computeRef', () => {
  it.each`
    baseRef      | mergeRef     | delta     | result
    ${undefined} | ${undefined} | ${[1, 2]} | ${'e4tEP48WbeAPyyMX-iR91_nNv68Lz6_iEAF2DOuA8IA'}
    ${null}      | ${null}      | ${[1, 2]} | ${'e4tEP48WbeAPyyMX-iR91_nNv68Lz6_iEAF2DOuA8IA'}
    ${undefined} | ${undefined} | ${[3, 2]} | ${'tzR6s--4kaAP4stUmtJrYkCkBw4EQiB21Ubym8S5TJM'}
    ${'hello'}   | ${undefined} | ${[1, 2]} | ${'fv38CwR5uuYSAv4mj9BVsup68Gn2ui9wsRefumjZw64'}
    ${'hello'}   | ${'there'}   | ${[1, 2]} | ${'Ds_llmZ9Wr1yLauPZd5aSR83TnAGPWlYd6cGpGAaZD4'}
  `(
    'computeRef($baseRef, $mergeRef, $delta) => $result',
    ({ baseRef, mergeRef, delta, result }) => {
      expect(computeRef(baseRef, mergeRef, delta)).toEqual(result);
    },
  );
});
