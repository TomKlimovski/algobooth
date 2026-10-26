// The sound packs bundled beside the drum machines, shared by `scripts/fetch-samples.ts` (which downloads them into
// app/public/samples) and the engine (which registers them). Each source is a public GitHub repository, fetched once
// at dev time; the app never touches the network for sounds.

/** The Salamander grand piano Strudel's own site plays as `piano` (felixroos/dough-samples, CC-BY 3.0). */
export const PIANO_SOURCE = 'https://raw.githubusercontent.com/felixroos/dough-samples/main';

/** Dirt-Samples (tidalcycles/Dirt-Samples): the classic SuperDirt library. */
export const DIRT_SOURCE = 'https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/master';

/**
 * The Dirt-Samples folders the booth ships. The workshop's own sounds (`casio` to `numbers`, which strudel.cc
 * prebakes), then the ones a house set reaches for: chord stabs, vintage synth basses and pads, organ-ish keys,
 * rave stabs, real claps, club kicks and a couple of breaks. None of them shares a name with a drum voice, so
 * the plain drum names (`bd`, `hh`, ...) still play the 808.
 */
export const DIRT_SOUNDS: readonly string[] = [
  // the workshop
  'casio',
  'crow',
  'insect',
  'wind',
  'jazz',
  'metal',
  'east',
  'space',
  'numbers',
  // house and friends
  'house',
  'stab',
  'juno',
  'jvbass',
  'bass1',
  'bass3',
  'moog',
  'pad',
  'padlong',
  'rave',
  'rave2',
  'hoover',
  'realclaps',
  'clubkick',
  'linnhats',
  'sax',
  'pluck',
  'arpy',
  'yeah',
  'breaks125',
  'breath',
];

/** General MIDI soundfonts (felixroos/webaudiofontdata), the `gm_*` instruments of strudel.cc. */
export const SOUNDFONT_SOURCE = 'https://raw.githubusercontent.com/felixroos/webaudiofontdata/master/sound';

/**
 * The bundled `gm_*` instruments and their fonts, in strudel.cc's order (so `.n(1)` picks the same font there and
 * here), up to three each: keys, basses, strings, choirs, brass and the synth pads. `0330_FluidR3_GM_sf2_fible` is a
 * typo upstream (it never loads), so the finger bass has two.
 */
export const SOUNDFONTS: Readonly<Record<string, readonly string[]>> = {
  gm_piano: ['0000_JCLive_sf2_file', '0000_FluidR3_GM_sf2_file', '0000_Aspirin_sf2_file'],
  gm_epiano1: ['0040_JCLive_sf2_file', '0040_FluidR3_GM_sf2_file', '0040_Aspirin_sf2_file'],
  gm_epiano2: ['0050_JCLive_sf2_file', '0050_FluidR3_GM_sf2_file', '0050_Aspirin_sf2_file'],
  gm_vibraphone: ['0110_JCLive_sf2_file', '0110_Aspirin_sf2_file', '0110_Chaos_sf2_file'],
  gm_marimba: ['0120_JCLive_sf2_file', '0120_Aspirin_sf2_file', '0120_Chaos_sf2_file'],
  gm_xylophone: ['0130_JCLive_sf2_file', '0130_Aspirin_sf2_file', '0130_Chaos_sf2_file'],
  gm_kalimba: ['1080_JCLive_sf2_file', '1080_FluidR3_GM_sf2_file', '1080_Aspirin_sf2_file'],
  gm_drawbar_organ: ['0160_JCLive_sf2_file', '0160_Aspirin_sf2_file', '0160_Chaos_sf2_file'],
  gm_percussive_organ: ['0170_JCLive_sf2_file', '0170_Aspirin_sf2_file', '0170_Chaos_sf2_file'],
  gm_rock_organ: ['0180_JCLive_sf2_file', '0180_Aspirin_sf2_file', '0180_Chaos_sf2_file'],
  gm_accordion: ['0210_JCLive_sf2_file', '0210_FluidR3_GM_sf2_file', '0210_GeneralUserGS_sf2_file'],
  gm_electric_guitar_muted: ['0280_Aspirin_sf2_file', '0280_Chaos_sf2_file', '0280_GeneralUserGS_sf2_file'],
  gm_acoustic_bass: ['0320_JCLive_sf2_file', '0320_FluidR3_GM_sf2_file', '0320_Aspirin_sf2_file'],
  gm_electric_bass_finger: ['0330_JCLive_sf2_file', '0330_Aspirin_sf2_file'],
  gm_fretless_bass: ['0350_Aspirin_sf2_file', '0350_JCLive_sf2_file'],
  gm_synth_bass_1: ['0380_Chaos_sf2_file', '0380_FluidR3_GM_sf2_file', '0380_JCLive_sf2_file'],
  gm_synth_bass_2: ['0390_Aspirin_sf2_file', '0390_FluidR3_GM_sf2_file', '0390_GeneralUserGS_sf2_file'],
  gm_string_ensemble_1: ['0480_Aspirin_sf2_file', '0480_Chaos_sf2_file', '0480_FluidR3_GM_sf2_file'],
  gm_synth_strings_1: ['0500_Aspirin_sf2_file', '0500_GeneralUserGS_sf2_file', '0500_JCLive_sf2_file'],
  gm_synth_strings_2: ['0510_Aspirin_sf2_file', '0510_Chaos_sf2_file', '0510_GeneralUserGS_sf2_file'],
  gm_choir_aahs: ['0520_Aspirin_sf2_file', '0520_Chaos_sf2_file', '0520_FluidR3_GM_sf2_file'],
  gm_voice_oohs: ['0530_Aspirin_sf2_file', '0530_Chaos_sf2_file', '0530_FluidR3_GM_sf2_file'],
  gm_synth_choir: ['0540_Aspirin_sf2_file', '0540_Chaos_sf2_file', '0540_FluidR3_GM_sf2_file'],
  gm_brass_section: ['0610_JCLive_sf2_file', '0610_Aspirin_sf2_file', '0610_Chaos_sf2_file'],
  gm_synth_brass_1: ['0620_Aspirin_sf2_file', '0620_FluidR3_GM_sf2_file', '0621_Aspirin_sf2_file'],
  gm_blown_bottle: ['0760_FluidR3_GM_sf2_file', '0760_JCLive_sf2_file', '0760_Chaos_sf2_file'],
  gm_lead_2_sawtooth: ['0810_JCLive_sf2_file', '0810_Aspirin_sf2_file', '0810_Chaos_sf2_file'],
  gm_lead_8_bass_lead: ['0870_JCLive_sf2_file', '0870_Aspirin_sf2_file', '0870_Chaos_sf2_file'],
  gm_pad_new_age: ['0880_JCLive_sf2_file', '0880_Aspirin_sf2_file', '0880_Chaos_sf2_file'],
  gm_pad_warm: ['0890_JCLive_sf2_file', '0890_Aspirin_sf2_file', '0890_Chaos_sf2_file'],
  gm_pad_poly: ['0900_JCLive_sf2_file', '0900_Chaos_sf2_file', '0900_FluidR3_GM_sf2_file'],
  gm_pad_choir: ['0910_FluidR3_GM_sf2_file', '0910_JCLive_sf2_file', '0910_Aspirin_sf2_file'],
  gm_pad_bowed: ['0920_JCLive_sf2_file', '0920_Aspirin_sf2_file', '0920_GeneralUserGS_sf2_file'],
  gm_pad_halo: ['0940_Chaos_sf2_file', '0940_FluidR3_GM_sf2_file', '0940_GeneralUserGS_sf2_file'],
  gm_pad_sweep: ['0950_Aspirin_sf2_file', '0950_Chaos_sf2_file', '0950_FluidR3_GM_sf2_file'],
  gm_fx_crystal: ['0980_Aspirin_sf2_file', '0980_JCLive_sf2_file', '0980_Chaos_sf2_file'],
  gm_fx_atmosphere: ['0990_JCLive_sf2_file', '0990_Aspirin_sf2_file', '0990_Chaos_sf2_file'],
};

/** One key range of a soundfont: a sample file and how to pitch and loop it. */
export interface FontZone {
  /** Lowest and highest MIDI note the zone plays. */
  low: number;
  high: number;
  /** The sample's own pitch in cents (MIDI note × 100), tuning included. */
  pitch: number;
  /** Loop points in sample frames at `sampleRate`; no loop when `loopStart` is not inside the sample. */
  loopStart: number;
  loopEnd: number;
  sampleRate: number;
  /** The zone's audio file, relative to the soundfont folder. */
  file: string;
}

/** `soundfonts.json`: each instrument's fonts, in `SOUNDFONTS` order, as key-range zones. */
export type SoundfontManifest = Record<string, FontZone[][]>;

/** Keep `_base` and the entries named in `names`. */
export function pickSounds(manifest: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
  const keep = new Set(['_base', ...names]);
  return Object.fromEntries(Object.entries(manifest).filter(([key]) => keep.has(key)));
}

/**
 * The zones of a webaudiofont preset file (`var _tone_X={zones:[{midi:0,originalPitch:4400,...,file:'<base64>'}]}`),
 * read as text, never evaluated: the base64 `file` is the zone's audio (an MP3) and is returned as bytes.
 */
export function parseFont(source: string): Array<Omit<FontZone, 'file'> & { audio: Uint8Array }> {
  const zones: Array<Omit<FontZone, 'file'> & { audio: Uint8Array }> = [];
  // A zone is a `{...}` with no braces inside; its file is a single-quoted base64 string (which may contain `//`).
  for (const block of source.matchAll(/\{([^{}]*)\}/g)) {
    const body = block[1];
    const file = /\bfile\s*:\s*'([^']*)'/.exec(body);
    if (!file) continue;
    const rest = body.replace(file[0], '').replace(/\/\/[^\n]*/g, '');
    const num = (key: string): number => {
      const m = new RegExp(`\\b${key}\\s*:\\s*(-?[\\d.]+)`).exec(rest);
      return m ? Number(m[1]) : 0;
    };
    zones.push({
      low: num('keyRangeLow'),
      high: num('keyRangeHigh'),
      pitch: num('originalPitch') - 100 * num('coarseTune') - num('fineTune'),
      loopStart: num('loopStart'),
      loopEnd: num('loopEnd'),
      sampleRate: num('sampleRate') || 44100,
      audio: Uint8Array.from(atob(file[1]), (c) => c.charCodeAt(0)),
    });
  }
  return zones;
}

/** The zone that plays `midi`: the first whose range holds it (the range's top is inclusive by one, as upstream). */
export function findZone<Z extends Pick<FontZone, 'low' | 'high'>>(zones: readonly Z[], midi: number): Z | undefined {
  return zones.find((z) => z.low <= midi && z.high + 1 >= midi);
}
