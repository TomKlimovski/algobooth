import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import * as draw from '@strudel/draw';
import * as webaudio from '@strudel/webaudio';

let enginePromise: Promise<void> | undefined;

const asset = (path: string): string => new URL(path, location.href).href;

async function boot(): Promise<void> {
  await webaudio.initAudio();
  await core.evalScope(core, mini, tonal, webaudio, draw);
  webaudio.registerSynthSounds();
  await webaudio.samples(
    asset('/samples/tidal-drum-machines.json'),
    asset('/samples/tidal-drum-machines/'),
    { prebake: true, tag: 'drum-machines' },
  );
  await webaudio.aliasBank(asset('/samples/tidal-drum-machines-alias.json'));
}

/**
 * Boots the Strudel engine from the app's bundled assets (no network).
 * Idempotent: every call returns the same promise. Decks pass it as `prebake`.
 */
export function initEngine(): Promise<void> {
  enginePromise ??= boot();
  return enginePromise;
}
