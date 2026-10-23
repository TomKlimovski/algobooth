// Dev-time only: downloads the bundled drum machine banks into app/public/samples
// so the app never needs strudel.b-cdn.net at runtime. `pnpm dev` and `pnpm build` run it first
// (so a fresh clone or worktree gets its samples), and `pnpm fetch-samples` runs it by hand.
// With the manifest already on disk it touches no network: it only fills in files that are missing.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_MACHINES, filterManifest } from '../app/src/engine/banks.ts';

const CDN = 'https://strudel.b-cdn.net';
const CONCURRENCY = 8;
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../app/public/samples');
const filesDir = join(outDir, 'tidal-drum-machines');

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

/** The filtered manifest as written on disk, or null when it (or the alias file) is not there yet. */
async function localManifest(): Promise<Record<string, unknown> | null> {
  if (!(await exists(join(outDir, 'tidal-drum-machines-alias.json')))) return null;
  try {
    return JSON.parse(await readFile(join(outDir, 'tidal-drum-machines.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return null; // missing or not JSON (the app's own complaint): fetch it again
  }
}

async function main(): Promise<void> {
  let filtered = await localManifest();
  if (!filtered) {
    const manifest = (await (await fetchOk(`${CDN}/tidal-drum-machines.json`)).json()) as Record<string, unknown>;
    const alias = await (await fetchOk(`${CDN}/tidal-drum-machines-alias.json`)).text();
    filtered = { ...filterManifest(manifest, BUNDLED_MACHINES), _base: './tidal-drum-machines/' };
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'tidal-drum-machines.json'), JSON.stringify(filtered, null, 2) + '\n');
    await writeFile(join(outDir, 'tidal-drum-machines-alias.json'), alias);
  }
  const paths = [
    ...new Set(
      Object.entries(filtered)
        .filter(([key]) => key !== '_base')
        .flatMap(([, value]) => value as string[]),
    ),
  ];
  for (const p of paths) {
    if (p.startsWith('/') || p.split('/').includes('..')) throw new Error(`refusing unsafe path ${p}`);
  }

  let totalBytes = 0;
  let downloaded = 0;
  const queue = [...paths];
  async function worker(): Promise<void> {
    for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
      const dest = join(filesDir, p);
      if (!(await exists(dest))) {
        const res = await fetchOk(`${CDN}/tidal-drum-machines/machines/${encodeURI(p)}`);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, new Uint8Array(await res.arrayBuffer()));
        downloaded++;
      }
      const { size } = await stat(dest);
      totalBytes += size;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (downloaded === 0) console.log(`samples: ${paths.length} files present, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
  else console.log(`samples: downloaded ${downloaded}, ${paths.length - downloaded} already present, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
