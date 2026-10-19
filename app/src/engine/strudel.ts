import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import * as draw from '@strudel/draw';
import * as webaudio from '@strudel/webaudio';
// The editor package provides the `slider(...)` widget (transpiled to `sliderWithID`) and `markcss`.
import * as codemirror from '@strudel/codemirror';

let enginePromise: Promise<void> | undefined;

const asset = (path: string): string => new URL(path, location.href).href;

const MANIFEST = '/samples/tidal-drum-machines.json';

/** Shown when the bundled drum machine samples are missing (a fresh clone that skipped the fetch). */
export const SAMPLES_HINT = 'The drum machine samples are missing: run `pnpm fetch-samples`, then Retry.';

/**
 * The bundled sample manifest. Fetched here rather than by superdough so that a missing file gives
 * the fetch-samples hint (a dev server may answer it with its HTML fallback page instead of a 404).
 */
async function sampleManifest(): Promise<unknown> {
  const res = await fetch(asset(MANIFEST));
  if (!res.ok) throw new Error(`${SAMPLES_HINT} (${MANIFEST}: HTTP ${res.status})`);
  try {
    return await res.json();
  } catch {
    throw new Error(`${SAMPLES_HINT} (${MANIFEST} is not JSON)`);
  }
}

/** Everything pattern code can reach by name. Mirrors what Strudel's own REPL scopes. */
export const SCOPE_MODULES: object[] = [core, mini, tonal, webaudio, draw, codemirror];

async function boot(): Promise<void> {
  await webaudio.initAudio();
  await core.evalScope(...SCOPE_MODULES);
  webaudio.registerSynthSounds();
  await webaudio.samples(await sampleManifest(), asset('/samples/tidal-drum-machines/'), {
    prebake: true,
    tag: 'drum-machines',
  });
  await webaudio.aliasBank(asset('/samples/tidal-drum-machines-alias.json'));
}

/**
 * Boots the Strudel engine from the app's bundled assets (no network).
 * Idempotent once it succeeds: every call returns the same promise. A failed boot is forgotten,
 * so the next call (the booth's Retry) boots again. Decks pass it as `prebake`.
 */
export function initEngine(): Promise<void> {
  enginePromise ??= boot().catch((e: unknown) => {
    enginePromise = undefined;
    throw e;
  });
  return enginePromise;
}
