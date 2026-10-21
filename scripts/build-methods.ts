// Dev-time only: builds app/src/methods/catalogue.json, the Methods panel's list, from the JSDoc in the
// pinned Strudel sources, so the app never fetches docs at runtime. Run with `pnpm build-methods`.
import { readFile, writeFile } from 'node:fs/promises';
import { register } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Catalogue, MethodDoc } from '../app/src/methods/catalogue.ts';
import { DEFAULTS, DENY, SOURCES } from '../app/src/methods/defaults.ts';
import { GROUP_OF, GROUPS } from '../app/src/methods/groups.ts';
import { exampleArgument, parseJsdocBlocks } from '../app/src/methods/parseJsdoc.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const strudel = (path: string) => resolve(root, 'node_modules/@strudel', path);
const EXCLUDING_TAGS = ['noAutocomplete', 'superdirtOnly', 'deprecated'];

// The core bundle imports @kabelsalat/web, whose node entry lacks the export; vitest stubs it the same way.
register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        return s === '@kabelsalat/web' ? { url: 'data:text/javascript,export class SalatRepl {}', shortCircuit: true } : next(s, c);
      }`,
    ),
);

/** JSDoc markup out of a description: bold, {@link X#name}, [text](url) and literal \n escapes. */
function plain(description: string): string {
  return description
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\{@link\s+(?:[^}\s#]*#)?([^}\s]+)\s*\}/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The hand table's argument text with its § markers stripped, and the range they marked. */
function marked(args: string): { args: string; range: [number, number] | null } {
  const start = args.indexOf('§');
  if (start === -1) return { args, range: null };
  const end = args.indexOf('§', start + 1);
  if (end === -1 || args.indexOf('§', end + 1) !== -1) throw new Error(`defaults: unbalanced § in ${args}`);
  return { args: args.replace(/§/g, ''), range: [start, end - 1] };
}

async function main(): Promise<void> {
  // The bundles, so tonal registers its methods on the same Pattern class that core exports.
  const { Pattern } = await import('@strudel/core/dist/index.mjs');
  await import('@strudel/tonal/dist/index.mjs');

  const methods: MethodDoc[] = [];
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const file of SOURCES) {
    for (const block of parseJsdocBlocks(await readFile(strudel(file), 'utf8'))) {
      const { name } = block;
      // controls.mjs repeats a few @name blocks (delayfeedback); the first one wins.
      if (seen.has(name)) continue;
      seen.add(name);
      if (name in DENY || EXCLUDING_TAGS.some((t) => block.tags.has(t))) continue;
      if (typeof Pattern.prototype[name] !== 'function') continue;

      const prefix = `.${name}(`;
      let args = '';
      let argRange: [number, number] | null = null;
      const hand = DEFAULTS[name];
      const example = block.example === null ? null : exampleArgument(block.example, name);
      if (hand) {
        const m = marked(hand.args);
        args = m.args;
        argRange = m.range && [prefix.length + m.range[0], prefix.length + m.range[1]];
      } else if (example !== null) {
        args = example;
        argRange = [prefix.length, prefix.length + example.length];
      } else if (block.params.length > 0) {
        missing.push(name);
        continue;
      }
      methods.push({
        name,
        synonyms: block.synonyms,
        description: plain(block.description),
        params: block.params,
        snippet: `${prefix}${args})`,
        argRange,
        group: GROUP_OF[name] ?? 'Other',
        source: `@strudel/${file}`,
        note: hand?.note ?? null,
        base: hand?.base ?? null,
      });
    }
  }
  if (missing.length > 0) {
    throw new Error(`no default argument for ${missing.length} methods; add them to DEFAULTS: ${missing.join(', ')}`);
  }

  const rank = (m: MethodDoc) => GROUPS.indexOf(m.group);
  methods.sort((a, b) => rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const version = async (pkg: string) =>
    (JSON.parse(await readFile(strudel(`${pkg}/package.json`), 'utf8')) as { version: string }).version;
  const catalogue: Catalogue = {
    versions: { '@strudel/core': await version('core'), '@strudel/tonal': await version('tonal') },
    methods,
  };
  await writeFile(resolve(root, 'app/src/methods/catalogue.json'), JSON.stringify(catalogue, null, 2) + '\n');

  console.log(`${methods.length} methods`);
  console.log(`Other: ${methods.filter((m) => m.group === 'Other').map((m) => m.name).join(', ')}`);
  const names = new Set(methods.map((m) => m.name));
  const unused = Object.keys(DEFAULTS).filter((n) => !names.has(n));
  if (unused.length > 0) console.log(`defaults with no catalogue row: ${unused.join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
