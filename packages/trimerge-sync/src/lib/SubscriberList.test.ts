import { SubscriberList } from './SubscriberList';

describe('SubscriberList', () => {
  it('one listener subscribes', () => {
    let value = 0;
    const s = new SubscriberList(() => value);
    const onChange = jest.fn();
    const unsub = s.subscribe(onChange);
    expect(onChange.mock.calls).toEqual([[0]]);
    s.emitChange(); // no change
    value = 1;
    s.emitChange(); // change
    s.emitChange(); // no change
    unsub();
    value = 2;
    s.emitChange(); // change, but no listeners
    expect(onChange.mock.calls).toEqual([[0], [1]]);
  });
  it('two listeners subscribes', () => {
    let value = 0;
    const s = new SubscriberList(() => value);
    const onChange1 = jest.fn();
    const unsub1 = s.subscribe(onChange1);
    s.emitChange(); // no change
    value = 1;
    const onChange2 = jest.fn();
    const unsub2 = s.subscribe(onChange2);
    expect(onChange1.mock.calls).toEqual([[0]]);
    expect(onChange2.mock.calls).toEqual([[1]]);
    s.emitChange(); // change
    unsub1();
    unsub2();
    expect(onChange1.mock.calls).toEqual([[0], [1]]);
    expect(onChange2.mock.calls).toEqual([[1]]);
  });
});
