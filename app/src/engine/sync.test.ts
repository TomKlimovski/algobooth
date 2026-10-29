import { vi } from 'vitest';
import { fakeDeck } from '../test/fakeDeck';
import { StartCancelled } from './evalLock';
import { secondsToNextBoundary, SyncController, syncRoles } from './sync';

type Timer = [() => void, number];
const recordTimers = () => {
  const timers: Timer[] = [];
  const setTimer = (f: () => void, ms: number) => { timers.push([f, ms]); return timers.length as any; };
  return { timers, setTimer };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

test('seconds to the next cycle boundary', () => {
  expect(secondsToNextBoundary(3.25, 0.5)).toBeCloseTo(1.5);
  expect(secondsToNextBoundary(4.0, 2)).toBeCloseTo(0.5); // exactly on a boundary waits a full cycle
});
test('engage refuses when A is stopped (review focus 4)', () => {
  const a = fakeDeck({ started: false }); const b = fakeDeck({ started: false });
  const s = new SyncController(() => a, () => b);
  expect(s.engage()).toEqual({ ok: false, reason: 'Start deck A first' });
  expect(s.engaged).toBe(false);
});
test('engage copies cps to B and schedules B start on the boundary', () => {
  const timers: Array<[() => void, number]> = [];
  const a = fakeDeck({ started: true, cps: 0.5, now: 3.25 });
  const b = fakeDeck({ started: true, cps: 0.6 });
  const s = new SyncController(() => a, () => b, (f, ms) => { timers.push([f, ms]); return 0 as any; });
  expect(s.engage()).toEqual({ ok: true });
  expect(b.setCps).toHaveBeenCalledWith(0.5);
  expect(b.scheduler.stop).toHaveBeenCalled();
  expect(timers[0][1]).toBeCloseTo(1500);
  timers[0][0]();
  expect(b.scheduler.start).toHaveBeenCalled();
});
test('while engaged, A re-eval propagates cps to B', () => {
  const a = fakeDeck({ started: true, cps: 0.5 }); const b = fakeDeck({ started: true, cps: 0.5 });
  const s = new SyncController(() => a, () => b, () => 0 as any);
  s.engage();
  a.scheduler.cps = 0.55; a.afterEval.forEach(f => f());
  expect(b.setCps).toHaveBeenLastCalledWith(0.55);
});
test('while engaged, B re-eval is pulled back to A tempo and reported', () => {
  const onTempoChange = vi.fn();
  const a = fakeDeck({ started: true, cps: 0.525 }); const b = fakeDeck({ id: 'B', started: true, cps: 0.525 });
  const s = new SyncController(() => a, () => b, () => 0 as any, { onTempoChange });
  s.engage();
  b.scheduler.cps = 0.4167; b.afterEval.forEach(f => f()); // B's own setcpm(100/4)
  expect(b.scheduler.cps).toBe(0.525);
  expect(onTempoChange).toHaveBeenLastCalledWith('B', 0.525);
});
test('release unhooks and re-evaluates B so its own setcpm applies again', () => {
  const timers: Array<() => void> = [];
  const a = fakeDeck({ started: true, cps: 0.5 }); const b = fakeDeck({ started: true, cps: 0.5 });
  const s = new SyncController(() => a, () => b, (f) => { timers.push(f); return 0 as any; });
  s.engage();
  timers[0](); // B restarted on the boundary
  s.release();
  expect(s.engaged).toBe(false);
  expect(b.evaluate).toHaveBeenCalledWith();
  expect(a.afterEval.size).toBe(0);
  expect(b.afterEval.size).toBe(0);
  expect(a.onToggle.size).toBe(0);
  expect(b.onToggle.size).toBe(0);
  expect(b.scheduler.beforeStart).toBeUndefined();
  b.setCps.mockClear();
  a.scheduler.cps = 0.7; a.afterEval.forEach(f => f());
  expect(b.setCps).not.toHaveBeenCalled();
});
test('release before the boundary starts B at once and re-evaluates it', async () => {
  const cancel = vi.fn();
  const { timers, setTimer } = recordTimers();
  const a = fakeDeck({ started: true, cps: 0.5, now: 1.5 }); const b = fakeDeck({ started: true });
  const s = new SyncController(() => a, () => b, setTimer, { clearTimer: cancel });
  s.engage();
  s.release();
  expect(cancel).toHaveBeenCalledWith(1);
  await flush();
  expect(b.scheduler.started).toBe(true); // B was playing before engage, so it plays again
  expect(b.evaluate).toHaveBeenCalledWith();
  timers[0][0](); // a stale timer is harmless
  expect(b.scheduler.start).toHaveBeenCalledTimes(1);
});
test('engage on a stopped B matches tempo without starting it', () => {
  const timers: Array<() => void> = [];
  const a = fakeDeck({ started: true, cps: 0.5 }); const b = fakeDeck({ started: false, cps: 0.4 });
  const s = new SyncController(() => a, () => b, (f) => { timers.push(f); return 0 as any; });
  expect(s.engage()).toEqual({ ok: true });
  expect(b.setCps).toHaveBeenCalledWith(0.5);
  expect(b.scheduler.stop).not.toHaveBeenCalled();
  expect(timers).toHaveLength(0);
});
test('calls the timer unbound, as window.setTimeout requires', () => {
  const calls: number[] = [];
  // window.setTimeout throws "Illegal invocation" when called with another receiver.
  function strictTimer(this: unknown, _f: () => void, ms: number) {
    if (this !== undefined) throw new TypeError('Illegal invocation');
    calls.push(ms);
    return 0 as any;
  }
  const a = fakeDeck({ started: true, cps: 0.5, now: 0.5 }); const b = fakeDeck({ started: true });
  const s = new SyncController(() => a, () => b, strictTimer);
  expect(s.engage()).toEqual({ ok: true });
  expect(calls).toEqual([1000]);
});
test('engage compensates for the Cyclist clock lead (review: 60 ms lag)', () => {
  // now() reports the cycle at t - duration, and B's cycle 0 lands minLatency after start().
  const { timers, setTimer } = recordTimers();
  const clock = { duration: 0.05, minLatency: 0.01 };
  const a = fakeDeck({ started: true, cps: 0.5, now: 3.25, clock }); const b = fakeDeck({ started: true, clock });
  new SyncController(() => a, () => b, setTimer).engage();
  expect(timers[0][1]).toBeCloseTo(1500 - 60);
});
test('a lead past the boundary waits for the following one', () => {
  const { timers, setTimer } = recordTimers();
  const clock = { duration: 0.05, minLatency: 0.01 };
  const a = fakeDeck({ started: true, cps: 0.5, now: 3.99, clock }); const b = fakeDeck({ started: true, clock });
  new SyncController(() => a, () => b, setTimer).engage();
  expect(timers[0][1]).toBeCloseTo(20 - 60 + 2000);
});
test('without clock details the lead falls back to 0.05 s plus 0.01 s', () => {
  const { timers, setTimer } = recordTimers();
  const a = fakeDeck({ started: true, cps: 0.5, now: 3.25, clock: null }); const b = fakeDeck({ started: true, clock: null });
  new SyncController(() => a, () => b, setTimer).engage();
  expect(timers[0][1]).toBeCloseTo(1440);
});
test('B started while engaged waits for A\'s next boundary at A\'s tempo', async () => {
  const { timers, setTimer } = recordTimers();
  const a = fakeDeck({ started: true, cps: 0.5, now: 3.25 }); const b = fakeDeck({ started: false, cps: 0.4 });
  const s = new SyncController(() => a, () => b, setTimer);
  s.engage();
  b.setCps.mockClear();
  const playing = b.scheduler.start(); // the user presses Play on B
  expect(b.setCps).toHaveBeenCalledWith(0.5);
  expect(timers).toHaveLength(1);
  expect(timers[0][1]).toBeCloseTo(1500);
  await flush();
  expect(b.scheduler.started).toBe(false);
  timers[0][0]();
  await playing;
  expect(b.scheduler.started).toBe(true);
});
test('A restarting while engaged realigns a playing B', async () => {
  const { timers, setTimer } = recordTimers();
  const a = fakeDeck({ started: true, cps: 0.5, now: 3.25 }); const b = fakeDeck({ started: true });
  const s = new SyncController(() => a, () => b, setTimer);
  s.engage();
  timers[0][0]();
  await flush();
  expect(b.scheduler.started).toBe(true);
  a.scheduler.stop();
  await a.scheduler.start(); // A re-anchors to cycle 0
  expect(b.scheduler.stop).toHaveBeenCalledTimes(2);
  expect(b.scheduler.started).toBe(false);
  expect(timers).toHaveLength(2);
  timers[1][0]();
  await flush();
  expect(b.scheduler.started).toBe(true);
});
test('A restarting while B waits re-arms the wait on A\'s new timeline', async () => {
  const cancel = vi.fn();
  const { timers, setTimer } = recordTimers();
  const a = fakeDeck({ started: true, cps: 0.5, now: 3.25 }); const b = fakeDeck({ started: true });
  new SyncController(() => a, () => b, setTimer, { clearTimer: cancel }).engage();
  a.scheduler.now.mockReturnValue(0.5);
  a.scheduler.stop(); await a.scheduler.start();
  expect(cancel).toHaveBeenCalledWith(1);
  expect(timers[1][1]).toBeCloseTo(1000);
});
test('stopping B during the wait cancels its start', async () => {
  const cancel = vi.fn();
  const { timers, setTimer } = recordTimers();
  const a = fakeDeck({ started: true, cps: 0.5, now: 3.25 }); const b = fakeDeck({ started: true });
  const s = new SyncController(() => a, () => b, setTimer, { clearTimer: cancel });
  s.engage();
  b.scheduler.stop(); // the user presses Stop before the bar line
  expect(cancel).toHaveBeenCalledWith(1);
  timers[0][0]();
  await flush();
  expect(b.scheduler.started).toBe(false);
  expect(s.engaged).toBe(true);
});
test('dispose unhooks without touching B (review: unmount after decks are torn down)', async () => {
  const cancel = vi.fn();
  const { timers, setTimer } = recordTimers();
  const a = fakeDeck({ started: true, cps: 0.5, now: 3.25 }); const b = fakeDeck({ started: true });
  const s = new SyncController(() => a, () => b, setTimer, { clearTimer: cancel });
  s.engage();
  s.dispose();
  expect(s.engaged).toBe(false);
  expect(cancel).toHaveBeenCalledWith(1);
  expect(b.evaluate).not.toHaveBeenCalled();
  expect(b.scheduler.beforeStart).toBeUndefined();
  expect(a.afterEval.size + b.afterEval.size + a.onToggle.size + b.onToggle.size).toBe(0);
  timers[0][0]();
  await flush();
  expect(b.scheduler.started).toBe(false);
});
test('a dropped held start settles: stop, a second Play and dispose reject it as cancelled', async () => {
  const { timers, setTimer } = recordTimers();
  const a = fakeDeck({ started: true, cps: 0.5, now: 3.25 }); const b = fakeDeck({ started: false });
  const s = new SyncController(() => a, () => b, setTimer);
  s.engage();
  const first = b.scheduler.start();
  const second = b.scheduler.start(); // a second Play replaces the first
  await expect(first).rejects.toBeInstanceOf(StartCancelled);
  b.scheduler.stop(); // Stop before the bar line
  await expect(second).rejects.toBeInstanceOf(StartCancelled);
  const third = b.scheduler.start();
  await flush();
  s.dispose();
  await expect(third).rejects.toBeInstanceOf(StartCancelled);
  timers.forEach(([f]) => f());
  await flush();
  expect(b.scheduler.started).toBe(false);
});
test('release lets a held start through instead of cancelling it', async () => {
  const { setTimer } = recordTimers();
  const a = fakeDeck({ started: true, cps: 0.5, now: 3.25 }); const b = fakeDeck({ started: false });
  const s = new SyncController(() => a, () => b, setTimer);
  s.engage();
  const playing = b.scheduler.start();
  await flush();
  s.release();
  await expect(playing).resolves.toBeUndefined();
  expect(b.scheduler.started).toBe(true);
});
test('the playing deck leads and the stopped one follows, whichever side it is on', () => {
  expect(syncRoles({ A: true, B: false }, 0.5)).toEqual({ leader: 'A', follower: 'B' });
  expect(syncRoles({ A: false, B: true }, 0.5)).toEqual({ leader: 'B', follower: 'A' });
});
test('with both playing, the deck the crossfader favours leads; at the centre A does', () => {
  expect(syncRoles({ A: true, B: true }, 0.8)).toEqual({ leader: 'B', follower: 'A' });
  expect(syncRoles({ A: true, B: true }, 0.2)).toEqual({ leader: 'A', follower: 'B' });
  expect(syncRoles({ A: true, B: true }, 0.5)).toEqual({ leader: 'A', follower: 'B' });
});
test('with neither playing there is nothing to sync to', () => {
  expect(syncRoles({ A: false, B: false }, 0.5)).toBeNull();
});
test('B can lead: A follows B\'s tempo and its start waits for B\'s bar', async () => {
  const { timers, setTimer } = recordTimers();
  const b = fakeDeck({ id: 'B', started: true, cps: 0.5, now: 3.25 });
  const a = fakeDeck({ id: 'A', started: false, cps: 0.6 });
  const s = new SyncController(() => b, () => a, setTimer);
  expect(s.engage()).toEqual({ ok: true });
  expect(a.setCps).toHaveBeenCalledWith(0.5);
  const started = a.scheduler.start();
  await flush();
  expect(a.scheduler.started).toBe(false);
  expect(timers.at(-1)![1]).toBeCloseTo(1500);
  timers.at(-1)![0]();
  await started;
  expect(a.scheduler.started).toBe(true);
});
test('the refusal names the leading deck', () => {
  const b = fakeDeck({ id: 'B', started: false }); const a = fakeDeck({ id: 'A' });
  expect(new SyncController(() => b, () => a).engage()).toEqual({ ok: false, reason: 'Start deck B first' });
});
