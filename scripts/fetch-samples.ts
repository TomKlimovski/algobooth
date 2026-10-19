// Dev-time only: downloads the bundled drum machine banks into app/public/samples
// so the app never needs strudel.b-cdn.net at runtime. Run with `pnpm fetch-samples`.
import { mkdir, stat, writeFile } from 'node:fs/promises';
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

async function main(): Promise<void> {
  const manifest = (await (await fetchOk(`${CDN}/tidal-drum-machines.json`)).json()) as Record<string, unknown>;
  const alias = await (await fetchOk(`${CDN}/tidal-drum-machines-alias.json`)).text();

  const filtered = { ...filterManifest(manifest, BUNDLED_MACHINES), _base: './tidal-drum-machines/' };
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

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'tidal-drum-machines.json'), JSON.stringify(filtered, null, 2) + '\n');
  await writeFile(join(outDir, 'tidal-drum-machines-alias.json'), alias);

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

  console.log(`downloaded ${downloaded}, skipped ${paths.length - downloaded} existing`);
  console.log(`${paths.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
