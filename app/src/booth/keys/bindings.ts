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

export const EMPTY_LAYOUT: Layout = { bindings: {} };

/** When a key press takes effect. */
export type Quantise = 'now' | 'beat' | 'bar';
