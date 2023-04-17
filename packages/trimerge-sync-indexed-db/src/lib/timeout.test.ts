import { timeout } from './timeout';

describe('timeout', () => {
  it('times out', async () => {
    const start = Date.now();
    await timeout();
    const end = Date.now();
    expect(end - start).toBeLessThanOrEqual(100);
  });
  it('times out with number', async () => {
    const start = Date.now();
    await timeout(50);
    const end = Date.now();
    expect(end - start).toBeGreaterThanOrEqual(45);
  });
});
