import { createStore } from 'solid-js/store';
import { vi } from 'vitest';
import { fakeDeck, type FakeDeck } from '../../test/fakeDeck';
import { createBoothState } from '../boothState';
import { createDeckState, type DeckId } from '../deckState';
import type { Pattern } from '../../library/api';
import type { Binding, Layout, MethodPart, Quantise } from './bindings';
import { REFUSED_CUE } from './cue';
import { KeyController } from './KeyController';

const LPENV: Binding = { kind: 'method', name: 'lpenv', snippet: '.lpenv(2)', argRange: [7, 8] };
const FAST: Binding = { kind: 'method', name: 'fast', snippet: '.fast(2)', argRange: [6, 7] };
const ROOM: MethodPart = { name: 'room', snippet: '.room(0.5)', argRange: [6, 9] };
const CODE = 'setcpm(120/4)\ndrums: s("bd*4")\nhats: s("hh*8")';

function setup(opts: { code?: string; started?: boolean; now?: number; cps?: number; quantise?: Quantise; global?: Layout } = {}) {
  const deckState = { A: createDeckState('A'), B: createDeckState('B') };
  const make = (id: DeckId): FakeDeck => {
    const code = opts.code ?? CODE;
    deckState[id].setLiveCode(code);
    deckState[id].setCode(code); // as last evaluated
    return fakeDeck({
      id,
      code,
      started: opts.started ?? false,
      now: opts.now ?? 0,
      cps: opts.cps ?? 0.5,
      onCode: (c) => deckState[id].setLiveCode(c),
    });
  };
  const decks = { A: make('A'), B: make('B') };
  const booth = createBoothState();
  let performing: DeckId = 'A';
  let global: Layout = opts.global ?? { bindings: { KeyQ: LPENV } };
  const setPerforming = vi.fn((id: DeckId) => { performing = id; });
  const setGlobal = vi.fn(async (l: Layout) => { global = l; });
  const ctl = new KeyController({
    decks: () => decks,
    deckState,
    performing: () => performing,
    setPerforming,
    booth,
    global: () => global,
    setGlobal,
    quantise: () => opts.quantise ?? 'bar',
    boothShowing: () => true,
  });
  return { ctl, decks, deckState, booth, setPerforming, setGlobal, a: decks.A, b: decks.B };
}

const tap = (ctl: KeyController, id: DeckId, slot: string) => {
  ctl.press(id, slot);
  ctl.release(id, slot);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

test('a tap on a stopped deck toggles the method on the target line, one Update each time', () => {
  const { ctl, a, deckState } = setup();
  ctl.togglePerform();
  expect(deckState.A.state.targetLine).toBe(1);
  tap(ctl, 'A', 'KeyQ');
  expect(a.getCode()).toBe('setcpm(120/4)\ndrums: s("bd*4").lpenv(2)\nhats: s("hh*8")');
  expect(a.applyEdits).toHaveBeenCalledTimes(1);
  expect(a.applyEdits.mock.calls[0][1]).toBe('input.key');
  expect(a.evaluate).toHaveBeenCalledTimes(1);
  expect(a.evaluate).toHaveBeenCalledWith(false);
  expect(ctl.shown('A').KeyQ?.on).toBe(true);
  tap(ctl, 'A', 'KeyQ');
  expect(a.getCode()).toBe(CODE);
  expect(ctl.shown('A').KeyQ?.on).toBe(false);
  expect(a.evaluate).toHaveBeenCalledTimes(2);
});

test('two presses inside one window cancel: no transaction and no Update (review focus 3)', () => {
  const { ctl, a, deckState } = setup({ started: true, now: 0.25, cps: 0.5 });
  ctl.togglePerform();
  tap(ctl, 'A', 'KeyQ');
  tap(ctl, 'A', 'KeyQ');
  expect(ctl.shown('A').KeyQ?.pending).toBe(true);
  expect(deckState.A.state.queued).toBe(2);
  expect(deckState.A.state.beatsLeft).toBe(3);
  vi.advanceTimersByTime(1500);
  expect(a.getCode()).toBe(CODE);
  expect(a.applyEdits).not.toHaveBeenCalled();
  expect(a.evaluate).not.toHaveBeenCalled();
  expect(ctl.shown('A').KeyQ?.pending).toBe(false);
  vi.advanceTimersByTime(200);
  expect(deckState.A.state.queued).toBe(0);
  expect(deckState.A.state.beatsLeft).toBeNull();
});

test('a hold released before its boundary still auditions for one quantum', () => {
  const { ctl, a } = setup({ started: true, now: 0.25, cps: 0.5 });
  ctl.togglePerform();
  ctl.press('A', 'KeyQ');
  expect(ctl.shown('A').KeyQ?.held).toBe(true);
  vi.advanceTimersByTime(300);
  ctl.release('A', 'KeyQ');
  expect(ctl.shown('A').KeyQ?.held).toBe(false);
  vi.advanceTimersByTime(1200); // the bar line at 1.5 s
  expect(a.getCode()).toContain('.lpenv(2)');
  expect(a.evaluate).toHaveBeenCalledTimes(1);
  a.scheduler.now.mockReturnValue(1); // the deck is on the bar line now: the revert waits a whole bar
  vi.advanceTimersByTime(1000);
  expect(a.getCode()).toContain('.lpenv(2)');
  vi.advanceTimersByTime(1100);
  expect(a.getCode()).toBe(CODE);
  expect(a.evaluate).toHaveBeenCalledTimes(2);
});

test('a hold released after it landed reverts on the next boundary; a tap does not', () => {
  const { ctl, a } = setup();
  ctl.togglePerform();
  ctl.press('A', 'KeyQ');
  expect(a.getCode()).toContain('.lpenv(2)');
  vi.advanceTimersByTime(300);
  ctl.release('A', 'KeyQ');
  expect(a.getCode()).toBe(CODE);
  expect(a.evaluate).toHaveBeenCalledTimes(2);
});

test('a line key mutes and unmutes its own line, whatever the target', () => {
  const { ctl, a } = setup();
  ctl.togglePerform();
  // Z and X are the derived line keys: drums, hats.
  expect(ctl.shown('A').KeyX?.binding).toEqual({ kind: 'line', label: 'hats' });
  expect(ctl.shown('A').KeyX?.on).toBe(true);
  tap(ctl, 'A', 'KeyX');
  expect(a.getCode()).toContain('\n_hats: s("hh*8")');
  expect(ctl.shown('A').KeyX?.on).toBe(false);
  tap(ctl, 'A', 'KeyX');
  expect(a.getCode()).toBe(CODE);
});

test('a refusal shows in the error line and marks the key refused until the code changes', () => {
  const { ctl, deckState, a } = setup({ code: 'drums: s("bd*4").\n  fast(2)+' });
  ctl.togglePerform();
  tap(ctl, 'A', 'KeyQ');
  expect(deckState.A.state.error).toBe('this line cannot take a method');
  expect(ctl.shown('A').KeyQ?.refused).toBe(true);
  expect(a.evaluate).not.toHaveBeenCalled();
  a.setCode('drums: s("bd*4")');
  expect(ctl.shown('A').KeyQ?.refused).toBe(false);
});

test('a click on a chain selects it: the line at the clicked offset becomes the target, a comment or setup line leaves it', () => {
  const code = 'setcpm(120/4)\n$: s("bd")\n// build\n$: note("c2")\n  .s("sawtooth")';
  const { ctl, deckState } = setup({ code });
  ctl.togglePerform();
  expect(deckState.A.state.targetLine).toBe(1);
  ctl.selectAt('A', code.indexOf('sawtooth'));
  expect(deckState.A.state.targetLine).toBe(2);
  ctl.selectAt('A', code.indexOf('build'));
  expect(deckState.A.state.targetLine).toBe(2);
  ctl.selectAt('A', 2);
  expect(deckState.A.state.targetLine).toBe(2);
  ctl.selectAt('A', code.indexOf('bd'));
  expect(deckState.A.state.targetLine).toBe(1);
});

test('a digit past the last line leaves the target; a recall with fewer lines clamps it (review focus 2)', () => {
  const code = '$: s("bd")\n$: s("hh")\n$: s("cp")';
  const { ctl, deckState, a } = setup({ code });
  ctl.togglePerform();
  ctl.selectLine('A', 3);
  expect(deckState.A.state.targetLine).toBe(3);
  expect(() => ctl.selectLine('A', 9)).not.toThrow();
  expect(deckState.A.state.targetLine).toBe(3);
  deckState.A.setKeys({ bindings: {}, snapshots: { F1: '$: s("bd")' } });
  ctl.snapshot('A', 'F1', false);
  expect(a.getCode()).toBe('$: s("bd")');
  expect(deckState.A.state.targetLine).toBe(1);
  expect(a.evaluate).toHaveBeenCalledTimes(1);
});

test('snapshots: save writes the current code into the pattern layer; an empty slot says so', () => {
  const { ctl, deckState, a } = setup();
  ctl.snapshot('A', 'F3', true);
  expect(deckState.A.state.keys.snapshots?.F3).toBe(CODE);
  ctl.snapshot('A', 'F2', false);
  expect(deckState.A.state.error).toBe('no snapshot on F2');
  expect(a.applyEdits).not.toHaveBeenCalled();
});

test('a nudge doubles or halves the argument on the target line', () => {
  const { ctl, a } = setup();
  ctl.togglePerform();
  tap(ctl, 'A', 'KeyQ');
  ctl.nudge('A', 'KeyQ', 'up');
  expect(a.getCode()).toContain('.lpenv(4)');
  ctl.nudge('A', 'KeyQ', 'down');
  ctl.nudge('A', 'KeyQ', 'down');
  expect(a.getCode()).toContain('.lpenv(1)');
});

describe('the key handler', () => {
  const key = (code: string, init: KeyboardEventInit = {}, target: EventTarget = document.body, type = 'keydown') => {
    const e = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    return e;
  };
  let uninstall: () => void = () => {};
  afterEach(() => uninstall());

  test('letters do nothing outside perform mode; Escape enters it', () => {
    const { ctl, a, booth } = setup();
    uninstall = ctl.install(window);
    const e = key('KeyQ');
    expect(e.defaultPrevented).toBe(false);
    expect(a.getCode()).toBe(CODE);
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(booth.state.perform).toBe(true);
    expect(key('KeyQ').defaultPrevented).toBe(true);
    key('KeyQ', {}, document.body, 'keyup');
    expect(a.getCode()).toContain('.lpenv(2)');
    key('KeyQ', { shiftKey: true });
    expect(a.getCode()).toContain('.lpenv(4)');
    key('KeyQ', { ctrlKey: true });
    expect(a.getCode()).toContain('.lpenv(2)');
    const both = key('KeyQ', { ctrlKey: true, shiftKey: true });
    expect(both.defaultPrevented).toBe(false);
    expect(key('KeyQ', { altKey: true }).defaultPrevented).toBe(false);
    expect(a.getCode()).toContain('.lpenv(2)');
  });

  test('Escape does not enter perform mode while the save dialog is open', () => {
    const { ctl, booth } = setup();
    uninstall = ctl.install(window);
    const backdrop = document.createElement('div');
    backdrop.className = 'save-backdrop';
    document.body.append(backdrop);
    key('Escape');
    expect(booth.state.perform).toBe(false);
  });

  test('a form control keeps its keys, Meta passes through, Space is left to the transport (review focus 5)', () => {
    const { ctl, a, booth } = setup();
    uninstall = ctl.install(window);
    key('Escape');
    const input = document.createElement('input');
    document.body.append(input);
    expect(key('KeyQ', {}, input).defaultPrevented).toBe(false);
    expect(a.getCode()).toBe(CODE);
    expect(key('KeyQ', { metaKey: true }).defaultPrevented).toBe(false);
    expect(key('Escape', { metaKey: true }).defaultPrevented).toBe(false);
    expect(booth.state.perform).toBe(true);
    expect(key('Space').defaultPrevented).toBe(false);
    expect(key('KeyQ', { repeat: true }).defaultPrevented).toBe(false);
    expect(a.getCode()).toBe(CODE);
  });

  test('digits pick the line in perform mode; Tab the deck and F-keys work in both modes', () => {
    const { ctl, deckState, setPerforming } = setup();
    uninstall = ctl.install(window);
    expect(key('F1', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(deckState.A.state.keys.snapshots?.F1).toBe(CODE);
    expect(key('Digit2').defaultPrevented).toBe(false);
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(setPerforming).toHaveBeenLastCalledWith('B');
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(setPerforming).toHaveBeenLastCalledWith('A');
    key('Escape');
    expect(key('Digit2').defaultPrevented).toBe(true);
    expect(deckState.A.state.targetLine).toBe(2);
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(setPerforming).toHaveBeenLastCalledWith('B');
    expect(deckState.B.state.targetLine).toBe(1);
  });

  test('in edit mode Tab inside the editor stays the editor\'s', () => {
    const { ctl, setPerforming } = setup();
    uninstall = ctl.install(window);
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    const line = document.createElement('div');
    editor.append(line);
    document.body.append(editor);
    expect(key('Tab', {}, line).defaultPrevented).toBe(false);
    expect(setPerforming).not.toHaveBeenCalled();
    editor.remove();
  });

  test('blur releases what is down as a hold', () => {
    const { ctl, a } = setup();
    uninstall = ctl.install(window);
    key('Escape');
    key('KeyQ');
    expect(a.getCode()).toContain('.lpenv(2)');
    window.dispatchEvent(new Event('blur'));
    expect(a.getCode()).toBe(CODE);
  });
});

test('perform mode locks both editors, and leaving it focuses the performing deck at its target', () => {
  const { ctl, a, b, booth } = setup();
  a.cursor.mockReturnValue(CODE.indexOf('hats'));
  ctl.togglePerform();
  expect(booth.state.perform).toBe(true);
  expect(a.setLocked).toHaveBeenCalledWith(true);
  expect(b.setLocked).toHaveBeenCalledWith(true);
  ctl.togglePerform();
  expect(booth.state.perform).toBe(false);
  expect(a.setLocked).toHaveBeenLastCalledWith(false);
  expect(b.setLocked).toHaveBeenLastCalledWith(false);
  expect(a.focusLine).toHaveBeenCalledWith(3); // hats: pattern line 2, document line 3
  expect(b.focusLine).not.toHaveBeenCalled();
});

test('a drop writes to the layer that owns the slot', () => {
  const { ctl, deckState, setGlobal } = setup();
  deckState.A.setKeys({ bindings: { KeyW: FAST } });
  ctl.drop('A', 'KeyW', ROOM);
  expect(deckState.A.state.keys.bindings.KeyW).toEqual({ kind: 'macro', parts: [
    { name: 'fast', snippet: '.fast(2)', argRange: [6, 7] }, ROOM,
  ] });
  expect(setGlobal).not.toHaveBeenCalled();
  ctl.drop('A', 'KeyE', ROOM);
  expect(setGlobal).toHaveBeenCalledWith({ bindings: { KeyQ: LPENV, KeyE: { kind: 'method', ...ROOM } } });
});

test('the menu: hide writes null into the pattern, clear on a global key removes it globally', () => {
  const { ctl, deckState, setGlobal } = setup({ global: { bindings: { KeyQ: LPENV, KeyW: FAST } } });
  ctl.menu('A', 'KeyQ', 'hide');
  expect(deckState.A.state.keys.bindings.KeyQ).toBeNull();
  expect(ctl.shown('A').KeyQ).toBeUndefined();
  ctl.menu('A', 'KeyW', 'clear');
  expect(setGlobal).toHaveBeenCalledWith({ bindings: { KeyQ: LPENV } });
  ctl.menu('B', 'KeyQ', 'keep');
  expect(deckState.B.state.keys.bindings.KeyQ).toEqual(LPENV);
  ctl.menu('B', 'KeyQ', 'global');
  expect(deckState.B.state.keys.bindings.KeyQ).toBeUndefined();
});

test('a move takes the binding to the other slot in its own layer', () => {
  const { ctl, setGlobal } = setup();
  ctl.move('A', 'KeyQ', 'KeyW');
  expect(setGlobal).toHaveBeenCalledWith({ bindings: { KeyW: LPENV } });
});

test('Stop drops a pending queue; Play lands it at once', () => {
  const { ctl, a } = setup({ started: true, now: 0.25 });
  ctl.togglePerform();
  tap(ctl, 'A', 'KeyQ');
  a.scheduler.stop();
  vi.advanceTimersByTime(3000);
  expect(a.applyEdits).not.toHaveBeenCalled();
  a.scheduler.started = true;
  tap(ctl, 'A', 'KeyQ');
  a.onToggle.forEach((f) => f(true));
  expect(a.getCode()).toContain('.lpenv(2)');
});

test('Stop while a hold revert waits out its boundary reverts at once, and only once', () => {
  const { ctl, a } = setup({ started: true, now: 0.25 });
  ctl.togglePerform();
  ctl.press('A', 'KeyQ');
  vi.advanceTimersByTime(300);
  ctl.release('A', 'KeyQ');
  vi.advanceTimersByTime(1200); // lands on the bar; the revert waits lead + 20 ms before queueing
  expect(a.getCode()).toContain('.lpenv(2)');
  a.scheduler.stop();
  expect(a.getCode()).toBe(CODE);
  vi.advanceTimersByTime(5000);
  expect(a.getCode()).toBe(CODE);
  expect(a.evaluate).toHaveBeenCalledTimes(2);
});

test('Stop while a hold revert is queued runs it instead of discarding it; other presses are dropped', () => {
  const { ctl, a } = setup({ started: true, now: 0.25 });
  ctl.togglePerform();
  tap(ctl, 'A', 'KeyQ');
  vi.advanceTimersByTime(1500);
  expect(a.getCode()).toContain('.lpenv(2)');
  a.scheduler.now.mockReturnValue(1);
  ctl.press('A', 'KeyX'); // hats muted at the next bar...
  ctl.release('A', 'KeyX');
  ctl.press('A', 'KeyQ'); // ...and a hold of Q, already on: its revert re-inserts it
  vi.advanceTimersByTime(2000);
  expect(a.getCode()).not.toContain('.lpenv(2)');
  vi.advanceTimersByTime(300);
  ctl.release('A', 'KeyQ');
  tap(ctl, 'A', 'KeyZ'); // a plain press, queued with the revert
  a.scheduler.stop();
  expect(a.getCode()).toBe('setcpm(120/4)\ndrums: s("bd*4").lpenv(2)\n_hats: s("hh*8")');
});

test('a hold revert does nothing to code that no longer has what the hold put there', () => {
  const { ctl, a } = setup({ started: true, now: 0.25 });
  ctl.togglePerform();
  ctl.press('A', 'KeyQ');
  ctl.press('A', 'KeyX');
  vi.advanceTimersByTime(1500);
  expect(a.getCode()).toBe('setcpm(120/4)\ndrums: s("bd*4").lpenv(2)\n_hats: s("hh*8")');
  a.scheduler.now.mockReturnValue(1);
  vi.advanceTimersByTime(300);
  ctl.release('A', 'KeyQ');
  ctl.release('A', 'KeyX');
  const loaded = 'drums: s("bd*2")\n_hats: s("oh*4")';
  a.setCode(loaded); // another pattern, loaded before the bar
  vi.advanceTimersByTime(2000);
  // Q is not re-inserted; hats was muted by the hold, so its revert unmutes it.
  expect(a.getCode()).toBe('drums: s("bd*2")\nhats: s("oh*4")');
});

test('a deck is hooked once, whether it arrives raw or through the booth store', () => {
  const { ctl, a } = setup();
  const [store] = createStore({ deck: a });
  ctl.attach('A', store.deck);
  ctl.attach('A', a);
  ctl.lines('A');
  ctl.snapshot('A', 'F1', true); // goes through api(), which attaches lazily
  expect(a.onToggle.size).toBe(1);
  expect(a.afterEval.size).toBe(1);
});

test('a cancelled press still queued is taken back: no edit and no Update', () => {
  const { ctl, a, deckState } = setup({ started: true, now: 0.25, cps: 0.5 });
  ctl.togglePerform();
  ctl.press('A', 'KeyQ');
  expect(ctl.shown('A').KeyQ?.pending).toBe(true);
  ctl.cancel('A', 'KeyQ');
  expect(ctl.shown('A').KeyQ?.held).toBe(false);
  expect(ctl.shown('A').KeyQ?.pending).toBe(false);
  expect(deckState.A.state.queued).toBe(0);
  vi.advanceTimersByTime(3000);
  expect(a.applyEdits).not.toHaveBeenCalled();
  expect(a.evaluate).not.toHaveBeenCalled();
  // The key is up again: a later release is nothing, a later press is a fresh one.
  ctl.release('A', 'KeyQ');
  expect(a.applyEdits).not.toHaveBeenCalled();
});

test('a cancelled press that already landed reverts, leaving the code as it was', () => {
  const { ctl, a } = setup();
  ctl.togglePerform();
  ctl.press('A', 'KeyQ');
  expect(a.getCode()).toContain('.lpenv(2)');
  ctl.cancel('A', 'KeyQ');
  expect(a.getCode()).toBe(CODE);
  expect(ctl.shown('A').KeyQ?.held).toBe(false);
  expect(ctl.shown('A').KeyQ?.on).toBe(false);
  ctl.release('A', 'KeyQ');
  expect(a.getCode()).toBe(CODE);
});

describe('the target is the one pressed on', () => {
  const global: Layout = { bindings: { KeyQ: LPENV, KeyW: FAST } };

  test('digit, key, digit, key in one window: each lands on its own line', () => {
    const { ctl, a } = setup({ started: true, now: 0.25, cps: 0.5, global });
    ctl.togglePerform();
    ctl.selectLine('A', 1);
    tap(ctl, 'A', 'KeyQ');
    ctl.selectLine('A', 2);
    tap(ctl, 'A', 'KeyW');
    vi.advanceTimersByTime(1500);
    expect(a.getCode()).toBe('setcpm(120/4)\ndrums: s("bd*4").lpenv(2)\nhats: s("hh*8").fast(2)');
  });

  test('retarget mid-hold, release: the hold reverts on the original line', () => {
    const { ctl, a } = setup({ global });
    ctl.togglePerform();
    ctl.selectLine('A', 1);
    ctl.press('A', 'KeyQ');
    expect(a.getCode()).toContain('drums: s("bd*4").lpenv(2)');
    ctl.selectLine('A', 2);
    vi.advanceTimersByTime(300);
    ctl.release('A', 'KeyQ');
    expect(a.getCode()).toBe(CODE);
  });

  test('a nudge works on the line it was pressed on', () => {
    const code = 'drums: s("bd").lpenv(2)\nhats: s("hh").lpenv(2)';
    const { ctl, a } = setup({ code, started: true, now: 0.25, cps: 0.5, global });
    ctl.togglePerform();
    ctl.selectLine('A', 1);
    ctl.nudge('A', 'KeyQ', 'up');
    ctl.selectLine('A', 2);
    vi.advanceTimersByTime(1500);
    expect(a.getCode()).toBe('drums: s("bd").lpenv(4)\nhats: s("hh").lpenv(2)');
  });
});

describe('a load clears the queue', () => {
  const pattern = (code: string) => ({ name: 'new', code, cpm: 120, key: '', tags: [], source: { kind: 'manual' }, notes: '' }) as never;
  const load = (deck: FakeDeck, code: string) => {
    deck.setCode(code);
    deck.setFile('new.strudel', code, pattern(code));
  };

  test('a recall queued before a load does not land on the new pattern', () => {
    const { ctl, a, deckState } = setup({ started: true, now: 0.25, cps: 0.5 });
    deckState.A.setKeys({ bindings: {}, snapshots: { F1: '$: s("old")' } });
    ctl.snapshot('A', 'F1', false);
    expect(deckState.A.state.queued).toBe(1);
    load(a, 'fresh: s("cp")');
    vi.advanceTimersByTime(1500);
    expect(a.getCode()).toBe('fresh: s("cp")');
    expect(a.applyEdits).not.toHaveBeenCalled();
    expect(ctl.shown('A').F1).toBeUndefined();
  });

  test('a tap queued before a load is dropped, but a pending hold revert still runs', () => {
    const { ctl, a } = setup({ started: true, now: 0.25, cps: 0.5, global: { bindings: { KeyQ: LPENV, KeyW: FAST } } });
    ctl.togglePerform();
    ctl.press('A', 'KeyQ');
    vi.advanceTimersByTime(300);
    ctl.release('A', 'KeyQ');
    vi.advanceTimersByTime(1200); // the bar line: the hold lands
    const held = a.getCode();
    expect(held).toContain('.lpenv(2)');
    a.scheduler.now.mockReturnValue(1);
    vi.advanceTimersByTime(30); // past the boundary: the revert is queued for the next bar
    tap(ctl, 'A', 'KeyW');
    load(a, held); // the same text reloaded from disk
    vi.advanceTimersByTime(2100);
    expect(a.getCode()).toBe(CODE);
  });
});

test('an Escape something else already handled (a menu, the editor) does not toggle perform mode', () => {
  const { ctl, booth } = setup();
  const uninstall = ctl.install(window);
  const handled = (e: Event) => e.preventDefault();
  document.addEventListener('keydown', handled, true);
  try {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }));
    expect(booth.state.perform).toBe(false);
  } finally {
    document.removeEventListener('keydown', handled, true);
    uninstall();
  }
});

const ACID = { name: 'Acid line', code: 'setcpm(126/4)\n$: note("c2")', cpm: 126, key: '', tags: [], source: { kind: 'mine' }, notes: '' } as Pattern;

describe('cue, go and clear', () => {
  const MARK = '// cued: Acid line · 126 cpm · its lines are on the home row · Go finishes, Clear drops';
  test('a cue onto a playing deck appends the block at once with input.cue, evaluates, and the line is on KeyA', () => {
    const { ctl, a, deckState } = setup({ started: true, now: 0.25, cps: 0.5 });
    ctl.cue('A', 'bass/acid.json', ACID);
    expect(a.getCode()).toBe(`${CODE}\n\n${MARK}\n_acid_line: note("c2")`);
    expect(a.applyEdits.mock.calls[0][1]).toBe('input.cue');
    expect(a.evaluate).toHaveBeenCalledTimes(1);
    expect(deckState.A.state.cueSource).toEqual({ path: 'bass/acid.json', pattern: ACID });
    expect(ctl.shown('A').KeyA).toMatchObject({ owner: 'cued', short: 'acid_line', on: false });
  });
  test('a cue onto a stopped deck does not evaluate', () => {
    const { ctl, a } = setup();
    ctl.cue('A', 'p.json', ACID);
    expect(a.evaluate).not.toHaveBeenCalled();
  });
  test('a cued key flips its line on the bar like any line key', () => {
    const { ctl, a } = setup({ started: true, now: 0.25, cps: 0.5 });
    ctl.cue('A', 'p.json', ACID);
    ctl.togglePerform();
    tap(ctl, 'A', 'KeyA');
    expect(a.getCode()).toContain('_acid_line:');
    vi.advanceTimersByTime(1500);
    expect(a.getCode()).toContain('\nacid_line:');
  });
  test('cueing over a sounding cue lands on the bar (review focus 5)', () => {
    const { ctl, a } = setup({ started: true, now: 0.25, cps: 0.5 });
    ctl.cue('A', 'p.json', ACID);
    a.setCode(a.getCode().replace('_acid_line:', 'acid_line:'));
    const two = { ...ACID, name: 'Two', code: '$: s("hh")' };
    ctl.cue('A', 'two.json', two);
    expect(a.getCode()).toContain('acid_line:');
    vi.advanceTimersByTime(1500);
    expect(a.getCode()).not.toContain('acid_line');
    expect(a.getCode()).toContain('_two: s("hh")');
    expect(a.applyEdits.mock.calls.at(-1)![1]).toBe('input.cue');
  });
  test('cueing over a silent cue replaces it at once', () => {
    const { ctl, a } = setup({ started: true, now: 0.25, cps: 0.5 });
    ctl.cue('A', 'p.json', ACID);
    ctl.cue('A', 'two.json', { ...ACID, name: 'Two', code: '$: s("hh")' });
    expect(a.getCode()).not.toContain('acid_line');
    expect(a.getCode()).toContain('_two: s("hh")');
  });
  test('go runs through the queue, then points the deck at the cued file after the evaluation', () => {
    const { ctl, a, deckState } = setup({ started: true, now: 0.25, cps: 0.5 });
    ctl.cue('A', 'bass/acid.json', ACID);
    a.setCode(a.getCode().replace('_acid_line:', 'acid_line:'));
    ctl.go('A');
    expect(deckState.A.state.queued).toBe(1);
    expect(a.getCode()).toContain(MARK);
    vi.advanceTimersByTime(1500);
    expect(a.getCode()).toBe('setcpm(120/4)\n\n$: note("c2")');
    expect(a.applyEdits.mock.calls.at(-1)![1]).toBe('input.go');
    expect(a.setName).toHaveBeenCalledWith('Acid line');
    expect(a.setFile).toHaveBeenCalledWith('bass/acid.json', ACID.code, ACID);
    expect(a.evaluate.mock.invocationCallOrder[1]).toBeLessThan(a.setFile.mock.invocationCallOrder[0]);
    expect(deckState.A.state.cueSource).toBeNull();
  });
  test('go without a cueSource keeps the name and file (review focus 3)', () => {
    const { ctl, a } = setup({ code: `${CODE}\n\n${MARK}\n_acid_line: note("c2")` });
    ctl.go('A');
    expect(a.getCode()).toBe('setcpm(120/4)\n\n_acid_line: note("c2")');
    expect(a.setFile).not.toHaveBeenCalled();
    expect(a.setName).not.toHaveBeenCalled();
  });
  test('go does nothing without a cue', () => {
    const { ctl, a } = setup();
    ctl.go('A');
    expect(a.applyEdits).not.toHaveBeenCalled();
  });
  test('clear on a silent cue is immediate with no evaluation; on a sounding cue it lands on the bar', () => {
    const silent = setup({ started: true, now: 0.25, cps: 0.5 });
    silent.ctl.cue('A', 'p.json', ACID);
    silent.a.evaluate.mockClear();
    silent.ctl.clearCue('A');
    expect(silent.a.getCode()).toBe(CODE);
    expect(silent.a.evaluate).not.toHaveBeenCalled();
    expect(silent.deckState.A.state.cueSource).toBeNull();
    const loud = setup({ started: true, now: 0.25, cps: 0.5 });
    loud.ctl.cue('A', 'p.json', ACID);
    loud.a.setCode(loud.a.getCode().replace('_acid_line:', 'acid_line:'));
    loud.ctl.clearCue('A');
    expect(loud.a.getCode()).toContain('acid_line:');
    vi.advanceTimersByTime(1500);
    expect(loud.a.getCode()).toBe(CODE);
    expect(loud.a.applyEdits.mock.calls.at(-1)![1]).toBe('input.clear-cue');
  });
  test('a load clears the cue source', () => {
    const { ctl, a, deckState } = setup();
    ctl.cue('A', 'p.json', ACID);
    a.setFile('other.json', 'x', ACID);
    expect(deckState.A.state.cueSource).toBeNull();
  });
  test('a cue onto a deck that plays a bare expression is refused: no edit, no evaluation, the reason shows', () => {
    for (const code of ['setcpm(120/4)\ns("bd*4")', 'stack(\n  s("bd*4"),\n  s("hh*8")\n)']) {
      const { ctl, a, deckState } = setup({ code, started: true });
      ctl.cue('A', 'p.json', ACID);
      expect(a.getCode()).toBe(code);
      expect(a.applyEdits).not.toHaveBeenCalled();
      expect(a.evaluate).not.toHaveBeenCalled();
      expect(deckState.A.state.error).toBe(REFUSED_CUE);
      expect(deckState.A.state.cueSource).toBeNull();
    }
  });
  test('a cue then a Clear gives back a rip file\'s text exactly (trailing newline, blank run)', () => {
    const RIP = '// Solomun 36:40 · 129 cpm\nsetcpm(129/4)\n\n\nbass: note("g1")\n  .s("sawtooth")\n// bars 5–9 add this\nbass2: note("g1")\n';
    const { ctl, a } = setup({ code: RIP, started: true });
    ctl.cue('A', 'p.json', ACID);
    expect(a.getCode()).toBe(`${RIP}\n${MARK}\n_acid_line: note("c2")\n`);
    ctl.clearCue('A');
    expect(a.getCode()).toBe(RIP);
  });
  test('a cue onto a playing deck with an edit not yet Updated does not evaluate it', () => {
    const { ctl, a } = setup({ started: true });
    a.setCode(`${CODE}\nbass: note("g1")`); // typed, not evaluated
    ctl.cue('A', 'p.json', ACID);
    expect(a.getCode()).toContain(MARK);
    expect(a.evaluate).not.toHaveBeenCalled();
  });
  test('cueing the same silent pattern again applies no edit and evaluates nothing', () => {
    const { ctl, a, deckState } = setup({ started: true });
    ctl.cue('A', 'p.json', ACID);
    deckState.A.setCode(a.getCode()); // the cue's evaluation landed
    ctl.cue('A', 'p.json', ACID);
    expect(a.applyEdits).toHaveBeenCalledTimes(1);
    expect(a.evaluate).toHaveBeenCalledTimes(1);
  });
  test('go when the cue source names another pattern keeps the name and file, and drops the source', () => {
    const { ctl, a, deckState } = setup({ code: `${CODE}\n\n${MARK}\n_acid_line: note("c2")` });
    deckState.A.setCueSource({ path: 'other.json', pattern: { ...ACID, name: 'Other' } });
    ctl.go('A');
    expect(a.getCode()).toBe('setcpm(120/4)\n\n_acid_line: note("c2")');
    expect(a.setFile).not.toHaveBeenCalled();
    expect(a.setName).not.toHaveBeenCalled();
    expect(deckState.A.state.cueSource).toBeNull();
  });
  test('go queued then Stop: the go is dropped, the cue and its source stay', () => {
    const { ctl, a, deckState } = setup({ started: true, now: 0.25, cps: 0.5 });
    ctl.cue('A', 'p.json', ACID);
    ctl.go('A');
    expect(deckState.A.state.queued).toBe(1);
    a.scheduler.stop();
    vi.advanceTimersByTime(3000);
    expect(a.getCode()).toContain(MARK);
    expect(deckState.A.state.queued).toBe(0);
    expect(deckState.A.state.cueSource).toEqual({ path: 'p.json', pattern: ACID });
  });
  describe('a hold across Go', () => {
    const OWN = 'drums: s("bd")\nbass: note("g1")';
    const BASS = { ...ACID, code: 'bass: note("c2")' } as Pattern;
    const mixing = () => {
      const t = setup({ code: OWN, started: true, now: 0.25, cps: 0.5 });
      t.ctl.cue('A', 'p.json', BASS);
      t.ctl.togglePerform();
      return t;
    };
    test('an own key held through Go and released after the bar does not touch the cued line that took its name', () => {
      const { ctl, a } = mixing();
      ctl.press('A', 'KeyX'); // own bass: muted on the bar
      ctl.go('A');
      vi.advanceTimersByTime(1500);
      expect(a.getCode()).toBe('_bass: note("c2")');
      const edits = a.applyEdits.mock.calls.length;
      ctl.release('A', 'KeyX');
      a.scheduler.now.mockReturnValue(1);
      vi.advanceTimersByTime(4000);
      expect(a.getCode()).toBe('_bass: note("c2")');
      expect(a.applyEdits).toHaveBeenCalledTimes(edits);
    });
    test('an own key held and released before the bar Go lands on leaves no revert behind', () => {
      const { ctl, a } = mixing();
      ctl.press('A', 'KeyX');
      vi.advanceTimersByTime(300);
      ctl.release('A', 'KeyX');
      ctl.go('A');
      vi.advanceTimersByTime(1200);
      expect(a.getCode()).toBe('_bass: note("c2")');
      const edits = a.applyEdits.mock.calls.length;
      a.scheduler.now.mockReturnValue(1);
      vi.advanceTimersByTime(4000);
      expect(a.getCode()).toBe('_bass: note("c2")');
      expect(a.applyEdits).toHaveBeenCalledTimes(edits);
      expect(ctl.shown('A').KeyZ?.pending).toBe(false);
    });
    test('a cued key held through Go stays as Go left it once released', () => {
      const { ctl, a } = mixing();
      ctl.press('A', 'KeyA'); // the cued bass: on, on the bar
      ctl.go('A');
      vi.advanceTimersByTime(1500);
      expect(a.getCode()).toBe('bass: note("c2")');
      const edits = a.applyEdits.mock.calls.length;
      ctl.release('A', 'KeyA');
      a.scheduler.now.mockReturnValue(1);
      vi.advanceTimersByTime(4000);
      expect(a.getCode()).toBe('bass: note("c2")');
      expect(a.applyEdits).toHaveBeenCalledTimes(edits);
    });
  });
  test('NumpadEnter is Go too', () => {
    const { ctl, a } = setup();
    const uninstall = ctl.install(window);
    ctl.cue('A', 'p.json', ACID);
    ctl.togglePerform();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'NumpadEnter', key: 'Enter', bubbles: true, cancelable: true }));
    expect(a.getCode()).toBe('setcpm(120/4)\n\n_acid_line: note("c2")');
    uninstall();
  });
  test('Enter is Go and Shift+Enter is Clear, in perform mode only', () => {
    const { ctl, a, booth } = setup();
    const uninstall = ctl.install(window);
    const enter = (shift: boolean) => document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', shiftKey: shift, bubbles: true, cancelable: true }));
    ctl.cue('A', 'p.json', ACID);
    enter(false);
    expect(a.getCode()).toContain(MARK);  // not performing: nothing
    ctl.togglePerform();
    expect(booth.state.perform).toBe(true);
    enter(true);
    expect(a.getCode()).toBe(CODE);
    ctl.cue('A', 'p.json', ACID);
    enter(false);
    expect(a.getCode()).toBe('setcpm(120/4)\n\n_acid_line: note("c2")');
    uninstall();
  });
});
