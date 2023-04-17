import { SubscriberList } from './SubscriberList';

describe('SubscriberList', () => {
  it('one listener subscribes', () => {
    let value = 0;
    const s = new SubscriberList(() => value);
    const onChange = jest.fn();
    const unsub = s.subscribe(onChange, '0');
    expect(onChange.mock.calls).toEqual([[0, '0']]);
    s.emitChange('1'); // no change
    value = 1;
    s.emitChange('2'); // change
    s.emitChange('3'); // no change
    unsub();
    value = 2;
    s.emitChange('4'); // change, but no listeners
    expect(onChange.mock.calls).toEqual([
      [0, '0'],
      [1, '2'],
    ]);
  });
  it('two listeners subscribes', () => {
    let value = 0;
    const s = new SubscriberList(() => value);
    const onChange1 = jest.fn();
    const unsub1 = s.subscribe(onChange1, '0');
    s.emitChange('1'); // no change
    value = 1;
    const onChange2 = jest.fn();
    const unsub2 = s.subscribe(onChange2, '2');
    expect(onChange1.mock.calls).toEqual([[0, '0']]);
    expect(onChange2.mock.calls).toEqual([[1, '2']]);
    s.emitChange('3'); // change
    unsub1();
    unsub2();
    expect(onChange1.mock.calls).toEqual([
      [0, '0'],
      [1, '3'],
    ]);
    expect(onChange2.mock.calls).toEqual([[1, '2']]);
  });
});
