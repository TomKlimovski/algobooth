import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { vi } from 'vitest';
import { PREVIEW_DELAY_MS } from '../../library/LibraryTree';
import { findMethod } from '../../methods/catalogue';
import { createDeckState } from '../deckState';
import { METHOD_MIME, type MethodDrag } from '../methodDrop';
import type { Binding, Quantise, Slot } from './bindings';
import type { KeyController, ShownKey } from './KeyController';
import { KEY_MIME, KeyStrip } from './KeyStrip';

const LPENV: Binding = { kind: 'method', name: 'lpenv', snippet: '.lpenv(2)', argRange: [7, 8] };
const FAST: Binding = { kind: 'method', name: 'fast', snippet: '.fast(2)', argRange: [6, 7] };
const key = (binding: Binding, owner: ShownKey['owner'], over: Partial<ShownKey> = {}): ShownKey => ({
  binding,
  owner,
  on: false,
  held: false,
  pending: false,
  refused: false,
  ...over,
});

const SHOWN: Partial<Record<Slot, ShownKey>> = {
  KeyQ: key(LPENV, 'global'),
  KeyW: key(FAST, 'pattern', { on: true }),
  KeyE: key(FAST, 'pattern', { held: true, pending: true }),
  KeyR: key(FAST, 'pattern', { refused: true }),
  KeyZ: key({ kind: 'line', label: 'fills' }, 'derived', { on: false }),
  KeyX: key({ kind: 'line', label: 'bass' }, 'derived', { on: true }),
};

let dispose = () => {};
let root: HTMLDivElement;
const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T & HTMLElement>(sel)!;
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const slot = (s: string) => $(`.key[data-slot="${s}"]`);
// jsdom has no PointerEvent; the strip reads only the mouse fields.
const fire = (el: Element, type: string, init: MouseEventInit = {}) =>
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));

function mount(opts: { perform?: boolean; performing?: boolean } = {}) {
  const [shown, setShown] = createSignal(SHOWN);
  const [perform, setPerform] = createSignal(opts.perform ?? false);
  const [performing, setPerforming] = createSignal(opts.performing ?? true);
  const [quantise, setQ] = createSignal<Quantise>('bar');
  const controller = {
    shown: vi.fn(() => shown()),
    lines: vi.fn(() => []),
    press: vi.fn(),
    release: vi.fn(),
    nudge: vi.fn(),
    selectLine: vi.fn(),
    snapshot: vi.fn(),
    togglePerform: vi.fn(),
    drop: vi.fn(),
    menu: vi.fn(),
    move: vi.fn(),
    cancel: vi.fn(),
  };
  const state = createDeckState('A');
  const setQuantise = vi.fn((q: Quantise) => setQ(q));
  root = document.createElement('div');
  document.body.append(root);
  dispose = render(
    () => (
      <KeyStrip
        deck="A"
        controller={controller as unknown as KeyController}
        state={state}
        perform={perform}
        performing={performing}
        quantise={quantise}
        setQuantise={setQuantise}
      />
    ),
    root,
  );
  return { controller, state, setShown, setPerform, setPerforming, setQuantise };
}

function dragEvent(type: string, data: Record<string, string>) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const dataTransfer = {
    types: Object.keys(data),
    getData: (t: string) => data[t] ?? '',
    setData: (t: string, v: string) => (data[t] = v),
    dropEffect: 'none',
    effectAllowed: 'none',
  };
  Object.defineProperty(e, 'dataTransfer', { value: dataTransfer });
  return e as DragEvent & { dataTransfer: typeof dataTransfer };
}
const methodDrag = (m: Partial<MethodDrag>): Record<string, string> => ({
  [METHOD_MIME]: JSON.stringify({ name: 'room', snippet: '.room(0.5)', argRange: [6, 9], kind: 'method', group: 'Reverb', ...m }),
});

afterEach(() => {
  dispose();
  root.remove();
  vi.useRealTimers();
});

test('draws the five rows: 26 letters, 9 digits, 8 F keys and the hint line', () => {
  mount();
  expect($('.key-strip').dataset.deck).toBe('A');
  expect($$('.key-row')).toHaveLength(5);
  expect($$('.key[data-slot]')).toHaveLength(26);
  expect($$('.key.num[data-n]').map((k) => k.dataset.n)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  expect($$('.key.fn[data-key]').map((k) => k.dataset.key)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8']);
  expect($('.key-hint').textContent).toContain('tap commit · hold audition · shift/ctrl+key nudge · 1–9 line · F1–F8 snapshot · tab deck · esc edit');
});

test('each key shows its letter, its label and its state as classes', () => {
  const { setShown } = mount();
  const q = slot('KeyQ');
  expect(q.querySelector('.key-letter')!.textContent).toBe('Q');
  expect(q.querySelector('.key-label')!.textContent).toBe('lpenv(2)');
  expect(q.classList.contains('bound')).toBe(true);
  expect(q.classList.contains('on')).toBe(false);
  expect(slot('KeyW').classList.contains('on')).toBe(true);
  expect(slot('KeyE').classList.contains('held')).toBe(true);
  expect(slot('KeyE').classList.contains('pending')).toBe(true);
  expect(slot('KeyR').classList.contains('refused')).toBe(true);
  const y = slot('KeyY');
  expect(y.classList.contains('bound')).toBe(false);
  expect(y.querySelector('.key-label')!.textContent).toBe('');
  // A line key shows the code's label: underscored while muted.
  const z = slot('KeyZ');
  expect(z.querySelector('.key-label')!.textContent).toBe('_fills');
  expect(['line', 'derived', 'muted'].every((c) => z.classList.contains(c))).toBe(true);
  const x = slot('KeyX');
  expect(x.querySelector('.key-label')!.textContent).toBe('bass');
  expect(x.classList.contains('muted')).toBe(false);
  expect(x.classList.contains('on')).toBe(false);
  // The strip follows the controller's state.
  setShown({ KeyQ: key(LPENV, 'global', { on: true }) });
  expect(slot('KeyQ').classList.contains('on')).toBe(true);
  expect(slot('KeyZ').classList.contains('line')).toBe(false);
});

test('mouse down and up on a key press and release it; shift and ctrl nudge instead', () => {
  const { controller } = mount();
  fire(slot('KeyQ'), 'pointerdown');
  expect(controller.press).toHaveBeenCalledWith('A', 'KeyQ');
  fire(slot('KeyQ'), 'pointerup');
  expect(controller.release).toHaveBeenCalledWith('A', 'KeyQ');
  // Leaving after the release is not a second release.
  slot('KeyQ').dispatchEvent(new MouseEvent('pointerleave'));
  expect(controller.release).toHaveBeenCalledTimes(1);
  // A press dragged off the key ends there.
  fire(slot('KeyW'), 'pointerdown');
  slot('KeyW').dispatchEvent(new MouseEvent('pointerleave'));
  expect(controller.release).toHaveBeenLastCalledWith('A', 'KeyW');
  controller.press.mockClear();
  fire(slot('KeyQ'), 'pointerdown', { shiftKey: true });
  expect(controller.nudge).toHaveBeenLastCalledWith('A', 'KeyQ', 'up');
  fire(slot('KeyQ'), 'pointerdown', { ctrlKey: true });
  expect(controller.nudge).toHaveBeenLastCalledWith('A', 'KeyQ', 'down');
  // A right button is the menu's, not a press.
  fire(slot('KeyQ'), 'pointerdown', { button: 2 });
  expect(controller.press).not.toHaveBeenCalled();
});

test('a digit targets its line and shows the target; an F key recalls, or with shift saves', () => {
  const { controller, state } = mount();
  fire($('.key.num[data-n="3"]'), 'click');
  expect(controller.selectLine).toHaveBeenCalledWith('A', 3);
  state.setTargetLine(2);
  expect($$('.key.num.on').map((k) => k.dataset.n)).toEqual(['2']);
  fire($('.key.fn[data-key="F2"]'), 'click');
  expect(controller.snapshot).toHaveBeenLastCalledWith('A', 'F2', false);
  fire($('.key.fn[data-key="F2"]'), 'click', { shiftKey: true });
  expect(controller.snapshot).toHaveBeenLastCalledWith('A', 'F2', true);
  expect($$('.key.fn.filled')).toHaveLength(0);
  state.setKeys({ bindings: {}, snapshots: { F5: 's("bd")' } });
  expect($$('.key.fn.filled').map((k) => k.dataset.key)).toEqual(['F5']);
});

test('a key accepts dragenter for a method or key drag, so WebKit makes it the drop target, and not for other drags', () => {
  mount();
  const enter = dragEvent('dragenter', methodDrag({}));
  slot('KeyY').dispatchEvent(enter);
  expect(enter.defaultPrevented).toBe(true);
  const text = dragEvent('dragenter', { 'text/plain': 'x' });
  slot('KeyY').dispatchEvent(text);
  expect(text.defaultPrevented).toBe(false);
});

test('a method dragged over a key marks it and drops onto it; a function is turned away', () => {
  const { controller, state } = mount();
  const over = dragEvent('dragover', methodDrag({}));
  slot('KeyY').dispatchEvent(over);
  expect(over.defaultPrevented).toBe(true);
  expect(over.dataTransfer.dropEffect).toBe('copy');
  expect(slot('KeyY').classList.contains('drop')).toBe(true);
  slot('KeyY').dispatchEvent(dragEvent('drop', methodDrag({})));
  expect(controller.drop).toHaveBeenCalledWith('A', 'KeyY', { name: 'room', snippet: '.room(0.5)', argRange: [6, 9] });
  expect(slot('KeyY').classList.contains('drop')).toBe(false);
  slot('KeyU').dispatchEvent(dragEvent('drop', methodDrag({ name: 'stack', snippet: 'stack()', kind: 'function' })));
  expect(controller.drop).toHaveBeenCalledTimes(1);
  expect(state.state.error).toBe('functions go in the editor, not on a key');
});

test('a key dragged onto another moves its binding; a derived line key does not drag', () => {
  const { controller } = mount();
  expect(slot('KeyQ').getAttribute('draggable')).toBe('true');
  expect(slot('KeyZ').getAttribute('draggable')).toBe('false');
  expect(slot('KeyY').getAttribute('draggable')).toBe('false');
  const data: Record<string, string> = {};
  fire(slot('KeyQ'), 'pointerdown');
  slot('KeyQ').dispatchEvent(dragEvent('dragstart', data));
  expect(data[KEY_MIME]).toBe('KeyQ');
  // A drag is not a tap: the press is cancelled, not released.
  expect(controller.cancel).toHaveBeenCalledWith('A', 'KeyQ');
  expect(controller.release).not.toHaveBeenCalled();
  const over = dragEvent('dragover', data);
  slot('KeyP').dispatchEvent(over);
  expect(over.defaultPrevented).toBe(true);
  expect(over.dataTransfer.dropEffect).toBe('move');
  slot('KeyP').dispatchEvent(dragEvent('drop', data));
  expect(controller.move).toHaveBeenCalledWith('A', 'KeyQ', 'KeyP');
  expect(controller.drop).not.toHaveBeenCalled();
});

test('right-click opens the menu for the key owner; derived keys have none', () => {
  const { controller } = mount();
  const items = () => $$('.lib-menu-item').map((b) => b.textContent);
  fire(slot('KeyQ'), 'contextmenu', { button: 2 });
  expect(items()).toEqual(['clear', 'hide for this pattern', 'keep with this pattern']);
  fire($$('.lib-menu-item')[2], 'click');
  expect(controller.menu).toHaveBeenCalledWith('A', 'KeyQ', 'keep');
  expect($$('.lib-menu')).toHaveLength(0);
  fire(slot('KeyW'), 'contextmenu', { button: 2 });
  expect(items()).toEqual(['clear', 'make global']);
  fire($$('.lib-menu-item')[1], 'click');
  expect(controller.menu).toHaveBeenLastCalledWith('A', 'KeyW', 'global');
  fire(slot('KeyZ'), 'contextmenu', { button: 2 });
  expect($$('.lib-menu')).toHaveLength(0);
  fire(slot('KeyY'), 'contextmenu', { button: 2 });
  expect($$('.lib-menu')).toHaveLength(0);
});

test('a shift-click nudge does not swallow the next right-click; a ctrl-click is not a menu', () => {
  mount();
  fire(slot('KeyW'), 'pointerdown', { shiftKey: true });
  fire(slot('KeyW'), 'pointerup', { shiftKey: true });
  fire(slot('KeyQ'), 'contextmenu', { button: 2 });
  expect($$('.lib-menu')).toHaveLength(1);
  fire($$('.lib-menu-item')[0], 'click');
  // macOS: ctrl+click is a contextmenu between the pointerdown and the pointerup.
  fire(slot('KeyQ'), 'pointerdown', { ctrlKey: true });
  fire(slot('KeyQ'), 'contextmenu', { ctrlKey: true });
  fire(slot('KeyQ'), 'pointerup', { ctrlKey: true });
  expect($$('.lib-menu')).toHaveLength(0);
  fire(slot('KeyQ'), 'contextmenu', { button: 2 });
  expect($$('.lib-menu')).toHaveLength(1);
});

test('resting on a method key shows the Methods panel tooltip for it', () => {
  vi.useFakeTimers();
  mount();
  slot('KeyQ').dispatchEvent(new MouseEvent('mouseenter'));
  vi.advanceTimersByTime(PREVIEW_DELAY_MS - 1);
  expect($$('.method-tip')).toHaveLength(0);
  vi.advanceTimersByTime(1);
  expect($('.method-tip').textContent).toContain(findMethod('lpenv')!.description);
  slot('KeyQ').dispatchEvent(new MouseEvent('mouseleave'));
  expect($$('.method-tip')).toHaveLength(0);
  // A line key has no method to describe.
  slot('KeyZ').dispatchEvent(new MouseEvent('mouseenter'));
  vi.advanceTimersByTime(PREVIEW_DELAY_MS);
  expect($$('.method-tip')).toHaveLength(0);
});

test('the hint line sets the quantise, toggles perform, and folds the strip except while performing', () => {
  const { controller, setQuantise, setPerform, setPerforming } = mount();
  expect($$('.key-quantise button[data-q]').map((b) => b.dataset.q)).toEqual(['now', 'beat', 'bar']);
  expect($$('.key-quantise button.on').map((b) => b.dataset.q)).toEqual(['bar']);
  fire($('.key-quantise button[data-q="beat"]'), 'click');
  expect(setQuantise).toHaveBeenCalledWith('beat');
  expect($$('.key-quantise button.on').map((b) => b.dataset.q)).toEqual(['beat']);
  expect($('.key-perform').getAttribute('aria-pressed')).toBe('false');
  fire($('.key-perform'), 'click');
  expect(controller.togglePerform).toHaveBeenCalled();
  const strip = $('.key-strip');
  fire($('.key-fold'), 'click');
  expect(strip.classList.contains('folded')).toBe(true);
  expect($('.key-fold').getAttribute('aria-expanded')).toBe('false');
  setPerform(true);
  expect($('.key-perform').getAttribute('aria-pressed')).toBe('true');
  expect(strip.classList.contains('folded')).toBe(false);
  expect(strip.classList.contains('dimmed')).toBe(false);
  setPerforming(false);
  expect(strip.classList.contains('dimmed')).toBe(true);
  setPerform(false);
  expect(strip.classList.contains('dimmed')).toBe(false);
  expect(strip.classList.contains('folded')).toBe(true);
});
