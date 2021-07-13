import { computeRef } from './index';

describe('computeRef', () => {
  it.each`
    baseRef      | mergeRef     | delta     | editMetadata  | result
    ${undefined} | ${undefined} | ${[1, 2]} | ${'hi'}       | ${'slefeaKS-06WMEZtIXIWXgmC6fFUWFaENkaxURMhwP8'}
    ${null}      | ${null}      | ${[1, 2]} | ${'hi'}       | ${'slefeaKS-06WMEZtIXIWXgmC6fFUWFaENkaxURMhwP8'}
    ${undefined} | ${undefined} | ${[3, 2]} | ${'hi'}       | ${'CCq3OpOtTeYPPk0YCSW8yzXsN-zY-4HG6NHp5_RKu6k'}
    ${undefined} | ${undefined} | ${[3, 2]} | ${'hi there'} | ${'QAK4T6AtKmxKuebS_1wBllhP-G624YXmKsQqC778Jtg'}
    ${'hello'}   | ${undefined} | ${[1, 2]} | ${'hi'}       | ${'dUHl1xTlni8fW7LTJuOUAhoaZxyHuPJgfeUajcS_e2U'}
    ${'hello'}   | ${'there'}   | ${[1, 2]} | ${'hi'}       | ${'tudzPVPEIApUcQVIQB9CvNICLz2vVgyl_ucgpYuGI5M'}
    ${'hello'}   | ${'there'}   | ${[1, 2]} | ${'hi there'} | ${'LWjiVabbHLdu3vxwLpgC8heaHtOKMf5r8kyZ_-yWqg0'}
  `(
    'computeRef($baseRef, $mergeRef, $delta, $editMetadata) => $result',
    ({ baseRef, mergeRef, delta, editMetadata, result }) => {
      expect(computeRef(baseRef, mergeRef, delta, editMetadata)).toEqual(
        result,
      );
    },
  );
});
