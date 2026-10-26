// Dev-time only: downloads the bundled sound packs into app/public/samples so the app never needs the network
// for sounds at runtime: the drum machine banks (strudel.b-cdn.net), the Salamander piano, the Dirt-Samples folders
// in `DIRT_SOUNDS` and the General MIDI soundfonts in `SOUNDFONTS` (all three from GitHub). `pnpm dev` and
// `pnpm build` run it first (so a fresh clone or worktree gets its samples), and `pnpm fetch-samples` runs it by hand.
// With a pack's manifest already on disk it touches no network for that pack: it only fills in files that are missing.
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_MACHINES, filterManifest } from '../app/src/engine/banks.ts';
import {
  DIRT_SOUNDS,
  DIRT_SOURCE,
  parseFont,
  pickSounds,
  PIANO_SOURCE,
  SOUNDFONT_SOURCE,
  SOUNDFONTS,
  type FontZone,
  type SoundfontManifest,
} from '../app/src/engine/packs.ts';

const CDN = 'https://strudel.b-cdn.net';
const CONCURRENCY = 8;
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../app/public/samples');

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** A JSON file on disk, or null when it is missing or not JSON (the app's own complaint): fetch it again. */
async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

const writeJson = (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + '\n');

/**
 * A `#` in a file name (Dirt-Samples' `pluck/BS A#2 PI.wav`) would end the URL the app fetches it by, so a manifest
 * written here spells it `%23`; the file on disk keeps its own name.
 */
const toUrlPath = (p: string) => p.replace(/#/g, '%23');
const fromUrlPath = (p: string) => p.replace(/%23/g, '#');

/** Every file a sample manifest names (each entry is a list of paths, or a note → path map for a pitched sample). */
function manifestPaths(manifest: Record<string, unknown>): string[] {
  const paths = Object.entries(manifest)
    .filter(([key]) => key !== '_base')
    .flatMap(([, value]) => (Array.isArray(value) ? value : Object.values(value as Record<string, string>)) as string[])
    .map(fromUrlPath);
  for (const p of paths) {
    if (p.startsWith('/') || p.split('/').includes('..')) throw new Error(`refusing unsafe path ${p}`);
  }
  return [...new Set(paths)];
}

/** Runs `job` over `items`, `CONCURRENCY` at a time. */
async function pool<T>(items: readonly T[], job: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const worker = async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await job(item);
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

interface Tally {
  files: number;
  downloaded: number;
  bytes: number;
}

/** Downloads each of `paths` from `sourceBase` into `dir` unless it is there already. */
async function fillFiles(dir: string, sourceBase: string, paths: string[]): Promise<Tally> {
  const tally: Tally = { files: paths.length, downloaded: 0, bytes: 0 };
  await pool(paths, async (p) => {
    const dest = join(dir, p);
    if (!(await exists(dest))) {
      const res = await fetchOk(`${sourceBase}/${p.split('/').map(encodeURIComponent).join('/')}`);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, new Uint8Array(await res.arrayBuffer()));
      tally.downloaded++;
    }
    const { size } = await stat(dest); // read before adding: `+= await` would add to a stale total
    tally.bytes += size;
  });
  return tally;
}

function report(pack: string, t: Tally): void {
  const mb = (t.bytes / 1024 / 1024).toFixed(1);
  if (t.downloaded === 0) console.log(`${pack}: ${t.files} files present, ${mb} MB`);
  else console.log(`${pack}: downloaded ${t.downloaded}, ${t.files - t.downloaded} already present, ${mb} MB`);
}

async function drumMachines(): Promise<Tally> {
  const manifestPath = join(outDir, 'tidal-drum-machines.json');
  let filtered = (await exists(join(outDir, 'tidal-drum-machines-alias.json')))
    ? await readJson<Record<string, unknown>>(manifestPath)
    : null;
  if (!filtered) {
    const manifest = (await (await fetchOk(`${CDN}/tidal-drum-machines.json`)).json()) as Record<string, unknown>;
    const alias = await (await fetchOk(`${CDN}/tidal-drum-machines-alias.json`)).text();
    filtered = { ...filterManifest(manifest, BUNDLED_MACHINES), _base: './tidal-drum-machines/' };
    await mkdir(outDir, { recursive: true });
    await writeJson(manifestPath, filtered);
    await writeFile(join(outDir, 'tidal-drum-machines-alias.json'), alias);
  }
  return fillFiles(join(outDir, 'tidal-drum-machines'), `${CDN}/tidal-drum-machines/machines`, manifestPaths(filtered));
}

/**
 * A sample pack described by a strudel.json-style manifest at `source`/`manifestName`: the entries in `names`
 * (all of them when omitted) are kept and written to `<pack>.json` with `_base` pointing at the local `<pack>/` folder.
 */
async function samplePack(pack: string, source: string, manifestName: string, names?: readonly string[]): Promise<Tally> {
  const manifestPath = join(outDir, `${pack}.json`);
  let manifest = await readJson<Record<string, unknown>>(manifestPath);
  if (!manifest) {
    const upstream = (await (await fetchOk(`${source}/${manifestName}`)).json()) as Record<string, unknown>;
    const picked = names ? pickSounds(upstream, names) : upstream;
    manifest = { ...JSON.parse(toUrlPath(JSON.stringify(picked))), _base: `./${pack}/` };
    const missing = (names ?? []).filter((n) => !(n in manifest!));
    if (missing.length) throw new Error(`${pack}: ${source}/${manifestName} has no ${missing.join(', ')}`);
    await mkdir(outDir, { recursive: true });
    await writeJson(manifestPath, manifest);
  }
  // A piano manifest's paths are relative to its own `_base` (…/piano/), a Dirt-Samples one's to the repository.
  const filesBase = pack === 'piano' ? `${source}/piano` : source;
  return fillFiles(join(outDir, pack), filesBase, manifestPaths(manifest));
}

/** One font, converted to plain files once: its zones as `<font>/zones.json` and each distinct sample as an MP3. */
async function font(dir: string, id: string): Promise<{ zones: FontZone[]; tally: Tally }> {
  const zonesPath = join(dir, id, 'zones.json');
  const onDisk = await readJson<FontZone[]>(zonesPath);
  if (onDisk) {
    const files = [...new Set(onDisk.map((z) => z.file))];
    const sizes = await Promise.all(files.map(async (f) => (await stat(join(dir, f))).size));
    return { zones: onDisk, tally: { files: files.length, downloaded: 0, bytes: sizes.reduce((a, b) => a + b, 0) } };
  }
  const source = await (await fetchOk(`${SOUNDFONT_SOURCE}/${id}.js`)).text();
  const parsed = parseFont(source);
  if (parsed.length === 0) throw new Error(`soundfonts: ${id} has no zones with audio`);
  await mkdir(join(dir, id), { recursive: true });
  // Neighbouring zones often share one sample; store each distinct one once.
  const byHash = new Map<string, string>();
  const zones: FontZone[] = [];
  let bytes = 0;
  for (const { audio, ...zone } of parsed) {
    const hash = createHash('sha1').update(audio).digest('hex');
    let file = byHash.get(hash);
    if (!file) {
      file = `${id}/${byHash.size}.mp3`;
      byHash.set(hash, file);
      await writeFile(join(dir, file), audio);
      bytes += audio.byteLength;
    }
    zones.push({ ...zone, file });
  }
  await writeJson(zonesPath, zones);
  return { zones, tally: { files: byHash.size, downloaded: byHash.size, bytes } };
}

async function soundfonts(): Promise<Tally> {
  const dir = join(outDir, 'soundfonts');
  const ids = [...new Set(Object.values(SOUNDFONTS).flat())];
  const fonts = new Map<string, FontZone[]>();
  const total: Tally = { files: 0, downloaded: 0, bytes: 0 };
  await pool(ids, async (id) => {
    const { zones, tally } = await font(dir, id);
    fonts.set(id, zones);
    total.files += tally.files;
    total.downloaded += tally.downloaded;
    total.bytes += tally.bytes;
  });
  const manifest: SoundfontManifest = Object.fromEntries(
    Object.entries(SOUNDFONTS).map(([name, list]) => [name, list.map((id) => fonts.get(id)!)]),
  );
  await writeJson(join(outDir, 'soundfonts.json'), manifest);
  return total;
}

const PACKS: Record<string, () => Promise<Tally>> = {
  'drum-machines': drumMachines,
  piano: () => samplePack('piano', PIANO_SOURCE, 'piano.json'),
  dirt: () => samplePack('dirt', DIRT_SOURCE, 'strudel.json', DIRT_SOUNDS),
  soundfonts,
};

/** Every pack, or only the ones named on the command line (`pnpm fetch-samples piano soundfonts`). */
async function main(): Promise<void> {
  const names = process.argv.slice(2);
  const unknown = names.filter((n) => !(n in PACKS));
  if (unknown.length) throw new Error(`unknown pack ${unknown.join(', ')}; packs: ${Object.keys(PACKS).join(', ')}`);
  for (const name of names.length ? names : Object.keys(PACKS)) report(name, await PACKS[name]());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
