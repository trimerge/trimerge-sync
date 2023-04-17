import { PromiseQueue } from './PromiseQueue';

describe('PromiseQueue', () => {
  it('queues', async () => {
    const actions: string[] = [];
    const exec = jest.fn(async (input) => {
      actions.push(`start ${input}`);
      await Promise.resolve(0);
      actions.push(`end ${input}`);
      return input;
    });

    const pq = new PromiseQueue();
    const p1 = pq.add(() => exec(1));
    const p2 = pq.add(() => exec(2));
    const p3 = pq.add(() => exec(3));
    const p4 = pq.add(() => exec(4));
    expect(actions).toEqual([]);
    await expect(p1).resolves.toEqual(1);
    expect(actions).toMatchInlineSnapshot(`
      [
        "start 1",
        "end 1",
        "start 2",
      ]
    `);
    await expect(p2).resolves.toEqual(2);
    await expect(p3).resolves.toEqual(3);
    await expect(p4).resolves.toEqual(4);
    expect(actions).toMatchInlineSnapshot(`
      [
        "start 1",
        "end 1",
        "start 2",
        "end 2",
        "start 3",
        "end 3",
        "start 4",
        "end 4",
      ]
    `);
  });
  it('queues rejection', async () => {
    const actions: string[] = [];
    const exec = jest.fn(async (input: number | Error) => {
      actions.push(`start ${input}`);
      if (typeof input === 'number') {
        await Promise.resolve(0);
      } else {
        await Promise.reject(input);
      }
      actions.push(`end ${input}`);
      return input;
    });

    const pq = new PromiseQueue();
    const p1 = pq.add(() => exec(1));
    const p2 = pq.add(() => exec(new Error('hi')));
    const p3 = pq.add(() => exec(3));
    const p4 = pq.add(() => exec(4));
    expect(actions).toEqual([]);
    await expect(p1).resolves.toEqual(1);
    expect(actions).toMatchInlineSnapshot(`
      [
        "start 1",
        "end 1",
        "start Error: hi",
      ]
    `);
    await expect(p2).rejects.toThrowError('hi');
    await expect(p3).resolves.toEqual(3);
    await expect(p4).resolves.toEqual(4);
    expect(actions).toMatchInlineSnapshot(`
      [
        "start 1",
        "end 1",
        "start Error: hi",
        "start 3",
        "end 3",
        "start 4",
        "end 4",
      ]
    `);
  });
});
