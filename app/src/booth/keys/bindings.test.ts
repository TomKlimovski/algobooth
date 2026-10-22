import { describe, expect, it } from 'vitest';
import {
  EMPTY_LAYOUT,
  dropTarget,
  effectiveLayout,
  labelOf,
  nameOf,
  sameLayout,
  withCleared,
  withDrop,
  withHidden,
  withMoved,
  withSnapshot,
  type Layout,
  type MethodPart,
} from './bindings';

const lpenv: MethodPart = { name: 'lpenv', snippet: '.lpenv(2)', argRange: [7, 8] };
const room: MethodPart = { name: 'room', snippet: '.room(0.5)', argRange: [6, 9] };
const method = (p: MethodPart) => ({ kind: 'method' as const, ...p });

describe('effectiveLayout', () => {
  it('shows the pattern over the global, owned by the pattern', () => {
    const g: Layout = { bindings: { KeyQ: method(lpenv) } };
    const p: Layout = { bindings: { KeyQ: method(room) } };
    expect(effectiveLayout(g, p, []).KeyQ).toEqual({ binding: method(room), owner: 'pattern' });
  });

  it('shows a global binding as global', () => {
    const g: Layout = { bindings: { KeyQ: method(lpenv) } };
    expect(effectiveLayout(g, EMPTY_LAYOUT, []).KeyQ?.owner).toBe('global');
  });

  it('hides a slot the pattern nulls', () => {
    const g: Layout = { bindings: { KeyQ: method(lpenv) } };
    const p: Layout = { bindings: { KeyQ: null } };
    expect(effectiveLayout(g, p, []).KeyQ).toBeUndefined();
  });

  it('derives line keys on the free bottom-row slots in order', () => {
    const shown = effectiveLayout(EMPTY_LAYOUT, EMPTY_LAYOUT, ['drums', 'fills']);
    expect(shown.KeyZ).toEqual({ binding: { kind: 'line', label: 'drums' }, owner: 'derived' });
    expect(shown.KeyX).toEqual({ binding: { kind: 'line', label: 'fills' }, owner: 'derived' });
  });

  it('pushes lines along past a bound bottom-row slot', () => {
    const g: Layout = { bindings: { KeyZ: method(lpenv) } };
    const shown = effectiveLayout(g, EMPTY_LAYOUT, ['drums', 'fills']);
    expect(shown.KeyZ?.owner).toBe('global');
    expect(shown.KeyX?.binding).toEqual({ kind: 'line', label: 'drums' });
    expect(shown.KeyC?.binding).toEqual({ kind: 'line', label: 'fills' });
  });

  it('does not derive a line onto a slot the pattern hides', () => {
    const p: Layout = { bindings: { KeyZ: null } };
    const shown = effectiveLayout(EMPTY_LAYOUT, p, ['drums']);
    expect(shown.KeyZ).toBeUndefined();
    expect(shown.KeyX?.binding).toEqual({ kind: 'line', label: 'drums' });
  });

  it('drops lines beyond the free slots', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `l${i}`);
    const shown = effectiveLayout(EMPTY_LAYOUT, EMPTY_LAYOUT, lines);
    expect(Object.keys(shown)).toHaveLength(7);
    expect(shown.KeyM?.binding).toEqual({ kind: 'line', label: 'l6' });
  });
});

describe('dropTarget', () => {
  const g: Layout = { bindings: { KeyQ: method(lpenv) } };
  it('is the pattern when it owns the slot', () => {
    expect(dropTarget(g, { bindings: { KeyQ: method(room) } }, 'KeyQ')).toBe('pattern');
  });
  it('is global when only the global binds it', () => {
    expect(dropTarget(g, EMPTY_LAYOUT, 'KeyQ')).toBe('global');
  });
  it('is global for an empty slot', () => {
    expect(dropTarget(g, EMPTY_LAYOUT, 'KeyW')).toBe('global');
  });
  it('is the pattern when it hides the slot', () => {
    expect(dropTarget(g, { bindings: { KeyQ: null } }, 'KeyQ')).toBe('pattern');
  });
});

describe('withDrop', () => {
  it('binds a method on an empty slot', () => {
    expect(withDrop(EMPTY_LAYOUT, 'KeyQ', lpenv).bindings.KeyQ).toEqual(method(lpenv));
  });
  it('makes a macro of two parts from a method', () => {
    const l = withDrop({ bindings: { KeyQ: method(lpenv) } }, 'KeyQ', room);
    expect(l.bindings.KeyQ).toEqual({ kind: 'macro', parts: [lpenv, room] });
  });
  it('appends to a macro', () => {
    const l = withDrop({ bindings: { KeyQ: { kind: 'macro', parts: [lpenv, room] } } }, 'KeyQ', lpenv);
    expect((l.bindings.KeyQ as { parts: MethodPart[] }).parts).toHaveLength(3);
  });
  it('replaces a line binding', () => {
    const l = withDrop({ bindings: { KeyZ: { kind: 'line', label: 'x' } } }, 'KeyZ', room);
    expect(l.bindings.KeyZ).toEqual(method(room));
  });
  it('returns a new object and leaves the input alone', () => {
    const input: Layout = { bindings: { KeyQ: method(lpenv) } };
    const out = withDrop(input, 'KeyQ', room);
    expect(out).not.toBe(input);
    expect(input.bindings.KeyQ).toEqual(method(lpenv));
  });
  it('leaves EMPTY_LAYOUT untouched', () => {
    withDrop(EMPTY_LAYOUT, 'KeyQ', room);
    expect(EMPTY_LAYOUT.bindings).toEqual({});
  });
});

describe('other edits', () => {
  const base: Layout = { bindings: { KeyQ: method(lpenv) } };
  it('withMoved moves a binding within the layer', () => {
    const out = withMoved(base, 'KeyQ', 'KeyW');
    expect(out.bindings).toEqual({ KeyW: method(lpenv) });
    expect(base.bindings.KeyQ).toBeDefined();
  });
  it('withCleared removes the slot', () => {
    const out = withCleared(base, 'KeyQ');
    expect('KeyQ' in out.bindings).toBe(false);
    expect(base.bindings.KeyQ).toBeDefined();
  });
  it('withHidden writes null', () => {
    expect(withHidden(EMPTY_LAYOUT, 'KeyQ').bindings.KeyQ).toBeNull();
  });
  it('withSnapshot sets, then null removes and drops the empty object', () => {
    const set = withSnapshot(EMPTY_LAYOUT, 'F1', 's("bd")');
    expect(set.snapshots).toEqual({ F1: 's("bd")' });
    const gone = withSnapshot(set, 'F1', null);
    expect(gone.snapshots).toBeUndefined();
    expect(set.snapshots).toEqual({ F1: 's("bd")' });
  });
});

describe('sameLayout', () => {
  it('treats undefined and empty alike', () => {
    expect(sameLayout(undefined, EMPTY_LAYOUT)).toBe(true);
    expect(sameLayout(null, { bindings: {} })).toBe(true);
  });
  it('compares structurally', () => {
    expect(sameLayout({ bindings: { KeyQ: method(lpenv) } }, { bindings: { KeyQ: method({ ...lpenv }) } })).toBe(true);
  });
  it('sees a differing argRange', () => {
    const other = { ...lpenv, argRange: [7, 9] as [number, number] };
    expect(sameLayout({ bindings: { KeyQ: method(lpenv) } }, { bindings: { KeyQ: method(other) } })).toBe(false);
  });
  it('sees a differing snapshot', () => {
    expect(sameLayout({ bindings: {}, snapshots: { F1: 'a' } }, EMPTY_LAYOUT)).toBe(false);
  });
});

describe('labels', () => {
  it('labelOf a macro joins its parts', () => {
    expect(labelOf({ kind: 'macro', parts: [lpenv, room] })).toBe('lpenv(2).room(0.5)');
  });
  it('labelOf a method drops the leading dot', () => {
    expect(labelOf(method(room))).toBe('room(0.5)');
  });
  it('labelOf a line is its label', () => {
    expect(labelOf({ kind: 'line', label: 'drums' })).toBe('drums');
  });
  it('nameOf', () => {
    expect(nameOf(method(room))).toBe('room');
    expect(nameOf({ kind: 'macro', parts: [lpenv, room] })).toBe('lpenv');
    expect(nameOf({ kind: 'line', label: 'x' })).toBeNull();
  });
});
