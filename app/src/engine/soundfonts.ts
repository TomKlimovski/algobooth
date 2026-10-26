import { freqToMidi, noteToMidi } from '@strudel/core';
import {
  getADSRValues,
  getAudioContext,
  getParamADSR,
  getPitchEnvelope,
  getVibratoOscillator,
  onceEnded,
  registerSound,
  releaseAudioNode,
} from '@strudel/webaudio';
import { findZone, type FontZone, type SoundfontManifest } from './packs';

// The `gm_*` instruments, played from the bundled `soundfonts.json` and its MP3s (`pnpm fetch-samples` converts
// them from webaudiofont presets). Adapted from @strudel/soundfonts' fontloader (AGPL-3.0, Strudel contributors),
// which fetches and evaluates the preset scripts from GitHub at play time; here nothing is fetched from the network
// and nothing is evaluated.

/** The level of a soundfont note at full gain, as upstream (its samples are mastered hot). */
const PEAK = 0.3;

const buffers = new Map<string, Promise<AudioBuffer>>();

function loadBuffer(url: string, ac: BaseAudioContext): Promise<AudioBuffer> {
  let buffer = buffers.get(url);
  if (!buffer) {
    buffer = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`soundfont sample ${url}: HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((data) => ac.decodeAudioData(data));
    buffer.catch(() => buffers.delete(url)); // a failed load is retried on the next note
    buffers.set(url, buffer);
  }
  return buffer;
}

/** The MIDI note of a hap value: its `freq`, else its `note` (a name or a number), else c3. */
export function midiOf(value: { note?: string | number; freq?: number }): number {
  if (value.freq) return freqToMidi(value.freq);
  const note = value.note ?? 'c3';
  return typeof note === 'string' ? noteToMidi(note) : note;
}

/** The playback rate that turns a zone's own pitch (in cents) into `midi`. */
export const playbackRate = (zone: Pick<FontZone, 'pitch'>, midi: number): number => Math.pow(2, (100 * midi - zone.pitch) / 1200);

/** The font a hap picks with `n`, wrapping as Strudel's sample index does. */
export function fontIndex(n: unknown, count: number): number {
  const i = Math.floor(Number(n) || 0);
  return ((i % count) + count) % count;
}

/**
 * Registers each instrument of `manifest` as a sound; `base` is the URL of the folder its files live in.
 * The first note of a font starts loading all of that font's samples, so the next ones are ready.
 */
export function registerSoundfonts(manifest: SoundfontManifest, base: string): void {
  const urlOf = (zone: FontZone) => new URL(zone.file, base).href;
  for (const [name, fonts] of Object.entries(manifest)) {
    registerSound(
      name,
      async (time: number, value: any, onended: () => void) => {
        const ac = getAudioContext();
        const zones = fonts[fontIndex(value.n, fonts.length)];
        const midi = midiOf(value);
        const zone = findZone(zones, midi);
        if (!zone) throw new Error(`${name} has no sample for MIDI note ${midi}`);
        for (const z of zones) void loadBuffer(urlOf(z), ac).catch(() => {});
        const src = ac.createBufferSource();
        src.buffer = await loadBuffer(urlOf(zone), ac);
        src.playbackRate.value = playbackRate(zone, midi);
        if (zone.loopStart > 1 && zone.loopStart < zone.loopEnd) {
          src.loop = true;
          src.loopStart = zone.loopStart / zone.sampleRate;
          src.loopEnd = zone.loopEnd / zone.sampleRate;
        }
        const [attack, decay, sustain, release] = getADSRValues([value.attack, value.decay, value.sustain, value.release]);
        const env = ac.createGain();
        src.connect(env);
        const holdEnd = time + value.duration;
        getParamADSR(env.gain, attack, decay, sustain, release, 0, PEAK, time, holdEnd, 'linear');
        const vibrato = getVibratoOscillator(src.detune, value, time);
        getPitchEnvelope(src.detune, value, time, holdEnd);
        src.start(time);
        src.stop(holdEnd + release + 0.01);
        onceEnded(src, () => {
          releaseAudioNode(src);
          vibrato?.stop();
          onended();
        });
        return { node: env, stop: () => {}, nodes: { source: [src], ...vibrato?.nodes } };
      },
      { type: 'soundfont', prebake: true, fonts: fonts.length },
    );
  }
}
