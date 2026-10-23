/** The method keyboard's data model: what a key does, and the layout a pattern file (or the settings) stores. */

/** A key position by physical code, 'KeyQ' to 'KeyM'. */
export type Slot = string;
export type SnapshotKey = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8';

/** One chained method call: its name, the snippet to add, and the span of the value a tweak edits. */
export interface MethodPart {
  name: string;
  snippet: string;
  argRange: [number, number] | null;
}

export type Binding =
  | ({ kind: 'method' } & MethodPart)
  | { kind: 'macro'; parts: MethodPart[] }
  | { kind: 'line'; label: string };

export interface Layout {
  bindings: Partial<Record<Slot, Binding | null>>;
  snapshots?: Partial<Record<SnapshotKey, string>>;
}

/** Frozen: every layout is immutable, each edit below returns a new one. */
export const EMPTY_LAYOUT: Layout = Object.freeze({ bindings: Object.freeze({}) }) as Layout;

/** When a key press takes effect. */
export type Quantise = 'now' | 'beat' | 'bar';

export const LETTER_ROWS: Slot[][] = [
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM'],
];

/** The bottom row, where a pattern's named lines show up as keys of their own. */
export const LINE_ROW: Slot[] = LETTER_ROWS[2];

/** The home row, where a cued pattern's lines show up the same way. */
export const CUE_ROW: Slot[] = LETTER_ROWS[1];

/** 'KeyQ' to 'Q', for the cap. */
export const SLOT_LETTER: Record<Slot, string> = Object.fromEntries(
  LETTER_ROWS.flat().map((slot) => [slot, slot.slice(3)]),
);

export type Owner = 'pattern' | 'global';
export interface Shown {
  binding: Binding;
  owner: Owner | 'derived' | 'cued';
  /** A cued line's cap: its label without the slug. */
  short?: string;
}

export interface CuedLine {
  label: string;
  short: string;
}

/**
 * What the deck shows: the global layout overlaid by the pattern's (a pattern `null` hides a slot),
 * then the pattern's named lines on whichever LINE_ROW slots are still free, in order. Lines past the
 * last free slot are dropped. `lines` are labels without their underscore. `cued` lines go the same way
 * onto the free CUE_ROW slots, after the own lines.
 */
export function effectiveLayout(
  global: Layout,
  pattern: Layout,
  lines: string[],
  cued: CuedLine[] = [],
): Partial<Record<Slot, Shown>> {
  const shown: Partial<Record<Slot, Shown>> = {};
  for (const [slot, binding] of Object.entries(global.bindings)) {
    if (binding) shown[slot] = { binding, owner: 'global' };
  }
  for (const [slot, binding] of Object.entries(pattern.bindings)) {
    if (binding) shown[slot] = { binding, owner: 'pattern' };
    else delete shown[slot];
  }
  // A hidden slot is not free: the pattern said it wants nothing there.
  const free = LINE_ROW.filter((slot) => !(slot in shown) && pattern.bindings[slot] !== null);
  lines.slice(0, free.length).forEach((label, i) => {
    shown[free[i]] = { binding: { kind: 'line', label }, owner: 'derived' };
  });
  const freeCue = CUE_ROW.filter((slot) => !(slot in shown) && pattern.bindings[slot] !== null);
  cued.slice(0, freeCue.length).forEach(({ label, short }, i) => {
    shown[freeCue[i]] = { binding: { kind: 'line', label }, owner: 'cued', short };
  });
  return shown;
}

/** The layer a drop on `slot` writes to: the pattern when it owns the slot (even hiding it), else the global. */
export function dropTarget(_global: Layout, pattern: Layout, slot: Slot): Owner {
  return slot in pattern.bindings ? 'pattern' : 'global';
}

function withBindings(layout: Layout, bindings: Layout['bindings']): Layout {
  return { ...layout, bindings };
}

/** A method dropped on a slot; one already bound there becomes a macro with the part appended. */
export function withDrop(layout: Layout, slot: Slot, part: MethodPart): Layout {
  const there = layout.bindings[slot];
  let binding: Binding;
  if (there?.kind === 'method') {
    const { kind: _kind, ...first } = there;
    binding = { kind: 'macro', parts: [first, part] };
  } else if (there?.kind === 'macro') {
    binding = { kind: 'macro', parts: [...there.parts, part] };
  } else {
    // Empty, hidden, or a derived line (never stored, so this is only defensive).
    binding = { kind: 'method', ...part };
  }
  return withBindings(layout, { ...layout.bindings, [slot]: binding });
}

export function withCleared(layout: Layout, slot: Slot): Layout {
  const { [slot]: _gone, ...rest } = layout.bindings;
  return withBindings(layout, rest);
}

/** Writes `null`, which in a pattern layer hides whatever the global layer has there. */
export function withHidden(pattern: Layout, slot: Slot): Layout {
  return withBindings(pattern, { ...pattern.bindings, [slot]: null });
}

/** Moves a binding to `to`; a binding already there swaps into `from`, so a move never loses a key. */
export function withMoved(layout: Layout, from: Slot, to: Slot): Layout {
  const binding = layout.bindings[from];
  if (from === to || binding === undefined) return layout;
  const { [from]: _gone, ...rest } = layout.bindings;
  const there = layout.bindings[to];
  return withBindings(layout, there ? { ...rest, [from]: there, [to]: binding } : { ...rest, [to]: binding });
}

/** Sets or (with null) removes a snapshot; an emptied `snapshots` object is dropped so layouts compare equal. */
export function withSnapshot(pattern: Layout, key: SnapshotKey, code: string | null): Layout {
  const { snapshots, ...rest } = pattern;
  const next = { ...snapshots };
  if (code === null) delete next[key];
  else next[key] = code;
  return Object.keys(next).length ? { ...rest, snapshots: next } : rest;
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every((k) => k in b && equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

/** Structural equality; a missing layout, an empty one, and one with an empty `snapshots` are all alike. */
export function sameLayout(a: Layout | null | undefined, b: Layout | null | undefined): boolean {
  const norm = (l: Layout | null | undefined) => {
    const snaps = l?.snapshots && Object.keys(l.snapshots).length ? l.snapshots : undefined;
    return { bindings: l?.bindings ?? {}, snapshots: snaps };
  };
  return equal(norm(a), norm(b));
}

/** The text on a key; a line shows its label as given (the caller knows whether it is muted). */
export function labelOf(binding: Binding): string {
  const strip = (p: MethodPart) => p.snippet.replace(/^\./, '');
  if (binding.kind === 'line') return binding.label;
  if (binding.kind === 'macro') return binding.parts.map(strip).join('.');
  return strip(binding);
}

/** The method a key is named for: the macro's first part, or null for a line. */
export function nameOf(binding: Binding): string | null {
  if (binding.kind === 'line') return null;
  return binding.kind === 'macro' ? (binding.parts[0]?.name ?? null) : binding.name;
}
