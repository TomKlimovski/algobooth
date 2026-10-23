// Dev-time only: builds app/src/lessons/workshop.json, the Lessons panel's text, from the Strudel workshop
// (website/src/pages/workshop in https://codeberg.org/uzu/strudel, AGPL-3.0 like this app). Run with
// `pnpm build-lessons <path to that workshop folder>`; the app never fetches lessons at runtime.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertLesson } from '../app/src/lessons/convert.ts';
import type { Workshop } from '../app/src/lessons/lessons.ts';

/** The chapters in reading order; `motors` (patterning robot motors over MQTT) needs hardware, so it is left out. */
const CHAPTERS = ['getting-started', 'first-sounds', 'first-notes', 'first-effects', 'pattern-effects', 'recap'];

const CREDIT =
  'Adapted from the Strudel workshop by the Strudel contributors (strudel.cc, AGPL-3.0). ' +
  'Sounds the booth does not ship are swapped for its drum machines and synths.';

const dir = process.argv[2];
if (!dir) throw new Error('usage: pnpm build-lessons <strudel>/website/src/pages/workshop');

const lessons = await Promise.all(
  CHAPTERS.map(async (id) => convertLesson(id, await readFile(join(dir, `${id}.mdx`), 'utf8'))),
);
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../app/src/lessons/workshop.json');
const workshop: Workshop = { credit: CREDIT, lessons };
await writeFile(out, JSON.stringify(workshop, null, 2) + '\n');
console.log(`wrote ${lessons.length} lessons to ${out}`);
