import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import * as draw from '@strudel/draw';
import * as webaudio from '@strudel/webaudio';
// The editor package provides the `slider(...)` widget (transpiled to `sliderWithID`) and `markcss`.
import * as codemirror from '@strudel/codemirror';
import { withPlainNames } from './banks';
import type { SoundfontManifest } from './packs';
import { registerSoundfonts } from './soundfonts';

let enginePromise: Promise<void> | undefined;

const asset = (path: string): string => new URL(path, location.href).href;

/** Shown when the bundled samples are missing (a fresh clone that skipped the fetch, or one from before a pack was added). */
export const SAMPLES_HINT = 'The bundled samples are missing: run `pnpm fetch-samples`, then Retry.';

/**
 * A bundled manifest. Fetched here rather than by superdough so that a missing file gives
 * the fetch-samples hint (a dev server may answer it with its HTML fallback page instead of a 404).
 */
async function manifest<T = Record<string, unknown>>(path: string): Promise<T> {
  const res = await fetch(asset(path));
  if (!res.ok) throw new Error(`${SAMPLES_HINT} (${path}: HTTP ${res.status})`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`${SAMPLES_HINT} (${path} is not JSON)`);
  }
}

/** Everything pattern code can reach by name. Mirrors what Strudel's own REPL scopes. */
export const SCOPE_MODULES: object[] = [core, mini, tonal, webaudio, draw, codemirror];

/**
 * Release the output device when the page goes away. A reload (Vite forces one when an engine module
 * changes) otherwise leaves the old context holding the device while the new page's context runs silently.
 */
function closeAudioOnPageHide(): void {
  window.addEventListener('pagehide', () => void webaudio.getAudioContext().close().catch(() => {}), { once: true });
}

async function boot(): Promise<void> {
  await webaudio.initAudio();
  closeAudioOnPageHide();
  await core.evalScope(...SCOPE_MODULES);
  webaudio.registerSynthSounds();
  // Every manifest is read before anything registers, so a missing pack fails the boot as a whole.
  const [drums, piano, dirt, fonts] = await Promise.all([
    manifest('/samples/tidal-drum-machines.json'),
    manifest('/samples/piano.json'),
    manifest('/samples/dirt.json'),
    manifest<SoundfontManifest>('/samples/soundfonts.json'),
  ]);
  await webaudio.samples(withPlainNames(drums), asset('/samples/tidal-drum-machines/'), { prebake: true, tag: 'drum-machines' });
  await webaudio.aliasBank(asset('/samples/tidal-drum-machines-alias.json'));
  await webaudio.samples(piano, asset('/samples/piano/'), { prebake: true, tag: 'piano' });
  await webaudio.samples(dirt, asset('/samples/dirt/'), { prebake: true, tag: 'dirt' });
  registerSoundfonts(fonts, asset('/samples/soundfonts/'));
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

// The audio graph and the Strudel scope are module singletons: a hot update would leave the
// old ones wired in while the UI drives new ones, so a change here reloads the whole page.
if (import.meta.hot) import.meta.hot.accept(() => import.meta.hot?.invalidate());
