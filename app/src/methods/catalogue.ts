import json from './catalogue.json';

export { GROUPS } from './groups';

/** One chainable Strudel method as the Methods panel offers it; built by `pnpm build-methods`. */
export interface MethodDoc {
  name: string;
  synonyms: string[];
  description: string;
  params: { name: string; type: string; description: string }[];
  /** What a drop inserts, e.g. `.duckattack(0.2)`. */
  snippet: string;
  /** Offsets of the argument to select within `snippet`, or null when nothing is selected. */
  argRange: [number, number] | null;
  group: string;
  /** Package and file, e.g. '@strudel/core/controls.mjs'. */
  source: string;
  /** An extra tooltip line, e.g. 'needs a chord() pattern'. */
  note: string | null;
  /** The pattern the evaluate test chains this method onto, when the group's default base will not sound. */
  base: string | null;
}

export interface Catalogue {
  /** The Strudel package versions the catalogue was built from. */
  versions: Record<string, string>;
  methods: MethodDoc[];
}

export const catalogue: Catalogue = json as Catalogue;
