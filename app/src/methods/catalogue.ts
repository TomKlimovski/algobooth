import json from './catalogue.json';

export { FUNCTION_GROUPS, GROUPS } from './groups';

/** One Strudel method or standalone function as the Methods panel offers it; built by `pnpm build-methods`. */
export interface MethodDoc {
  name: string;
  /** A method is chained onto a pattern and drops at a line's end; a function is an expression and drops at the pointer. */
  kind: 'method' | 'function';
  synonyms: string[];
  description: string;
  params: { name: string; type: string; description: string }[];
  /** What a drop inserts, e.g. `.duckattack(0.2)` or `stack(s("bd*4"), s("hh*8"))`. */
  snippet: string;
  /** Offsets of the argument to select within `snippet`, or null when nothing is selected. */
  argRange: [number, number] | null;
  group: string;
  /** Package and file, e.g. '@strudel/core/controls.mjs'. */
  source: string;
  /** An extra tooltip line, e.g. 'needs a chord() pattern'. */
  note: string | null;
  /**
   * For a method: the pattern the evaluate test chains it onto, when the group's default base will not sound.
   * For a function: the carrier the test puts the snippet into, with `{}` where the snippet goes.
   */
  base: string | null;
}

export interface Catalogue {
  /** The Strudel package versions the catalogue was built from. */
  versions: Record<string, string>;
  methods: MethodDoc[];
}

export const catalogue: Catalogue = json as Catalogue;

const byName = new Map<string, MethodDoc>();
// Methods first: a key holds a method, and a name both kinds share (stack, cat) means the method there.
for (const m of [...catalogue.methods].sort((a, b) => Number(a.kind !== 'method') - Number(b.kind !== 'method'))) {
  if (!byName.has(m.name)) byName.set(m.name, m);
}

/** The catalogue entry a key's method is named for, so the strip can show the panel's tooltip for it. */
export function findMethod(name: string | null): MethodDoc | undefined {
  return name === null ? undefined : byName.get(name);
}
