import { describe, expect, it } from 'vitest';
import { HOLD_MS, PressTracker } from './hold';

function setup() {
  let t = 1000;
  const tracker = new PressTracker(() => t);
  return { tracker, advance: (ms: number) => (t += ms) };
}

describe('PressTracker', () => {
  it('reports a press on first down and null on repeat', () => {
    const { tracker } = setup();
    expect(tracker.down('a')).toEqual({ type: 'press', slot: 'a' });
    expect(tracker.down('a')).toBeNull();
  });

  it('calls a quick release a tap', () => {
    const { tracker, advance } = setup();
    tracker.down('a');
    advance(100);
    expect(tracker.up('a')).toEqual({ type: 'release', slot: 'a', held: false });
  });

  it('calls a release at HOLD_MS a hold', () => {
    const { tracker, advance } = setup();
    tracker.down('a');
    advance(HOLD_MS);
    expect(tracker.up('a')).toEqual({ type: 'release', slot: 'a', held: true });
  });

  it('ignores an up with no down, and a second up', () => {
    const { tracker } = setup();
    expect(tracker.up('a')).toBeNull();
    tracker.down('a');
    tracker.up('a');
    expect(tracker.up('a')).toBeNull();
  });

  it('cancelAll returns the down slots and clears them', () => {
    const { tracker } = setup();
    tracker.down('a');
    tracker.down('b');
    expect(tracker.cancelAll().sort()).toEqual(['a', 'b']);
    expect(tracker.up('a')).toBeNull();
    expect(tracker.cancelAll()).toEqual([]);
  });
});
