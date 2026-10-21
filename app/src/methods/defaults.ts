/** The Strudel sources the catalogue is built from, relative to node_modules/@strudel. */
export const SOURCES: string[] = [
  'core/controls.mjs',
  'core/pattern.mjs',
  'core/signal.mjs',
  'tonal/tonal.mjs',
  'tonal/voicings.mjs',
];

const VOICING_REASON = 'a voicing() setting: it acts only before .voicing(), and a drop lands at the end of the line';
const BARE_VALUES = 'works on bare numbers, which do not sound; a drop onto a sound pattern does nothing';
const WAVETABLE = 'drives the wavetable oscillator, which needs wt_ samples the app does not ship';
const MIDI = 'MIDI output, not sound';

/** Methods the panel never offers: name → one-line reason. */
export const DENY: Record<string, string> = {
  orbit: 'orbits are the deck channels; a dropped orbit would reroute the deck',
  p: 'names a pattern; the editor handles it',
  q: 'names a pattern; the editor handles it',
  hush: 'transport; the deck has its own stop',
  pianoroll: 'drawing; the deck draws its own visualiser',
  punchcard: 'drawing; the deck draws its own visualiser',
  scope: 'drawing; the deck draws its own visualiser',
  spiral: 'drawing; the deck draws its own visualiser',
  pitchwheel: 'drawing; the deck draws its own visualiser',
  markcss: 'drawing; the deck draws its own visualiser',
  color: 'drawing; the deck draws its own visualiser',
  label: 'drawing: sets the pianoroll text',
  log: 'writes to the console',
  logValues: 'writes to the console',
  analyze: 'feeds an analyser, not sound',
  keyDown: 'gated on a held computer key',
  whenKey: 'gated on a held computer key',
  bypass: 'its whole point is silence',
  tag: 'tags events for filter(); no sound of its own',
  onTriggerTime: 'runs a callback at event time; no sound of its own',
  channel: 'a SuperDirt channel; the app plays through WebAudio',
  channels: 'output routing: the app owns the output channels (fixed when a deck is first built)',
  source: 'needs a hand-written WebAudio node factory',
  voicings: 'returns bare note names, which sound only with a .note() after it; voicing() replaces it',
  chord: VOICING_REASON,
  anchor: VOICING_REASON,
  offset: VOICING_REASON,
  mode: VOICING_REASON,
  dictionary: VOICING_REASON,
  round: BARE_VALUES,
  floor: BARE_VALUES,
  ceil: BARE_VALUES,
  range: BARE_VALUES,
  rangex: BARE_VALUES,
  range2: BARE_VALUES,
  ratio: BARE_VALUES,
  invert: 'swaps 1s and 0s in a binary pattern, which does not sound',
  ...Object.fromEntries(
    [
      'wt', 'wtenv', 'wtattack', 'wtdecay', 'wtsustain', 'wtrelease', 'wtrate', 'wtsync', 'wtdepth', 'wtshape',
      'wtdc', 'wtskew', 'wtphaserand', 'warp', 'warpmode', 'warpenv', 'warpattack', 'warpdecay', 'warpsustain',
      'warprelease', 'warprate', 'warpsync', 'warpdepth', 'warpshape', 'warpdc', 'warpskew',
    ].map((name) => [name, WAVETABLE]),
  ),
  ...Object.fromEntries(
    [
      'midichan', 'midiport', 'midicmd', 'control', 'ccn', 'ccv', 'nrpnn', 'nrpv', 'progNum', 'sysex', 'sysexid',
      'sysexdata', 'midibend', 'miditouch',
    ].map((name) => [name, MIDI]),
  ),
  oschost: 'OSC output, not sound',
  oscport: 'OSC output, not sound',
};

type Default = { args: string; base?: string; note?: string };

const SYNTH = 'note("c3 e3 g3 c4").s("sawtooth")';
const DRUMS = 's("bd*4").bank("tr909")';
const DUCK_NOTE = 'orbits here are decks: 1 = deck A, 2 = deck B';
const VOICING = { base: 'chord("<C^7 Dm7>")', note: 'needs a chord() pattern' };
const CALLBACK = 'x => x.speed(2)';

/** A family's parts only sound once the family's switch is on, so their test base turns it on. */
function needs(base: string, note: string, args: Record<string, string>): Record<string, Default> {
  return Object.fromEntries(Object.entries(args).map(([name, a]) => [name, { args: a, base, note }]));
}

/** The low-, high- and band-pass filter families: cutoff, resonance, envelope and LFO. */
function filterFamily(f: 'lp' | 'hp' | 'bp'): Record<string, Default> {
  const cutoff = `${f}f`;
  return {
    [cutoff]: { args: '§800§' },
    [`${f}q`]: { args: '§5§' },
    ...needs(`${SYNTH}.${cutoff}(300)`, `needs .${cutoff}()`, { [`${f}env`]: '§4§' }),
    ...needs(`${SYNTH}.${cutoff}(300).${f}env(4)`, `needs .${cutoff}() and .${f}env()`, {
      [`${f}attack`]: '§0.1§',
      [`${f}decay`]: '§0.2§',
      [`${f}sustain`]: '§0.5§',
      [`${f}release`]: '§0.3§',
    }),
    ...needs(`${SYNTH}.${cutoff}(800)`, `needs .${cutoff}()`, { [`${f}rate`]: '§4§', [`${f}sync`]: '§4§' }),
    ...needs(`${SYNTH}.${cutoff}(800).${f}sync(4)`, `needs .${cutoff}() and .${f}sync() or .${f}rate()`, {
      [`${f}depth`]: '§0.5§',
      [`${f}depthfrequency`]: '§400§',
      [`${f}shape`]: '§1§',
      [`${f}dc`]: '§0.5§',
      [`${f}skew`]: '§0.5§',
    }),
  };
}

/**
 * name → argument text with the selectable literal between § signs; optional base for the evaluate test,
 * optional tooltip note. Beats the JSDoc example's argument, so this is also where a poor example is fixed.
 */
export const DEFAULTS: Record<string, Default> = {
  // Sound
  s: { args: '"§hh§"' },
  bank: { args: '"§RolandTR808§"' },
  n: { args: '§1§' },
  note: { args: '"§c3 e3 g3§"' },
  clip: { args: '§0.5§' },
  duration: { args: '§0.25§' },
  begin: { args: '§0.25§' },
  end: { args: '§0.5§' },
  speed: { args: '§1.5§' },
  stretch: { args: '§1.5§' },
  loopAtCps: { args: '§2§, 0.5' },
  loop: { args: '§1§' },
  ...needs(`${DRUMS}.loop(1)`, 'needs .loop(1)', { loopBegin: '§0.25§', loopEnd: '§0.75§' }),
  slice: { args: '§4§, "0 2 1 3"' },
  splice: { args: '§4§, "0 2 1 3"' },
  scrub: { args: '"§0.25§"' },
  noise: { args: '§0.3§', base: SYNTH },
  density: { args: '§0.1§', base: 's("crackle*4")', note: 'for s("crackle")' },
  ...needs('note("c3 e3 g3 c4").s("pulse")', 'for s("pulse")', { pw: '§0.3§', pwrate: '§2§', pwsweep: '§0.3§' }),
  unison: { args: '§5§', base: 'note("c3 e3 g3 c4").s("supersaw")', note: 'for s("supersaw")' },
  partials: { args: '[1, 0.5, 0.3, 0.2]', base: SYNTH },
  phases: { args: '[0, 0.5, 0, 0.25]', base: SYNTH },
  ...needs('s("bytebeat")', 'for s("bytebeat")', {
    // Single quotes: a double-quoted string is mini-notation.
    byteBeatExpression: "'§t*(t>>15^t>>66)§'",
    byteBeatStartTime: '§10000§',
  }),

  // Pitch
  transpose: { args: '§7§' },
  scale: { args: '"§C:minor§"' },
  scaleTranspose: { args: '§2§', base: 'n("0 2 4 6").scale("C:minor").s("sawtooth")', note: 'needs a scale() pattern' },
  voicing: { args: '', ...VOICING },
  rootNotes: { args: '§2§', ...VOICING },
  add: { args: 'note(§12§)' },
  sub: { args: 'note(§12§)' },
  detune: { args: '§0.3§', base: 'note("c3 e3 g3 c4").s("supersaw")', note: 'for s("supersaw")' },
  vowel: { args: '"§a§"' },
  octave: { args: '§4§' },
  freq: { args: '§220§' },
  penv: { args: '§12§' },
  ...needs(`${SYNTH}.penv(12)`, 'needs .penv()', {
    pattack: '§0.1§',
    pdecay: '§0.1§',
    prelease: '§0.1§',
    pcurve: '§1§',
    panchor: '§0.5§',
  }),

  // Filter
  ...filterFamily('lp'),
  ...filterFamily('hp'),
  ...filterFamily('bp'),
  ...needs(`${SYNTH}.lpf(500)`, 'needs .lpf()', { ftype: '"§ladder§"' }),
  ...needs(`${SYNTH}.lpf(500).lpenv(4)`, 'needs .lpf() and .lpenv()', { fanchor: '§0.5§' }),
  djf: { args: '§0.3§' },

  // Envelope
  attack: { args: '§0.05§' },
  decay: { args: '§0.2§' },
  sustain: { args: '§0.5§' },
  release: { args: '§0.3§' },
  adsr: { args: '"§.01:.2:.5:.3§"' },

  // Dynamics
  gain: { args: '§0.8§' },
  velocity: { args: '§0.8§' },
  postgain: { args: '§0.8§' },
  transient: { args: '§0.5§' },

  // Ducking
  duckorbit: { args: '§2§', note: DUCK_NOTE },
  ...needs(`${DRUMS}.duckorbit(2)`, DUCK_NOTE, { duckattack: '§0.2§', duckdepth: '§0.8§', duckonset: '§0.01§' }),

  // Delay and Reverb
  delay: { args: '§0.5§' },
  ...needs(`${DRUMS}.delay(0.5)`, 'needs .delay()', {
    delayfeedback: '§0.5§',
    delayspeed: '§2§',
    delaysync: '§0.25§',
  }),
  room: { args: '§0.4§' },
  ...needs(`${DRUMS}.room(0.4)`, 'needs .room()', {
    roomsize: '§2§',
    roomlp: '§4000§',
    roomdim: '§2000§',
    roomfade: '§1§',
    iresponse: '"§RolandTR909_oh§"',
    irspeed: '§0.5§',
    irbegin: '§0.25§',
  }),

  // Modulation
  vib: { args: '§4§' },
  ...needs(`${DRUMS}.vib(4)`, 'needs .vib()', { vibmod: '§0.5§' }),
  fmi: { args: '§4§', base: SYNTH },
  ...needs(`${SYNTH}.fm(4)`, 'needs .fm()', {
    fmh: '§2§',
    fmenv: '"§lin§"',
    fmattack: '§0.1§',
    fmdecay: '§0.2§',
    fmsustain: '§0.5§',
    fmrelease: '§0.2§',
    fmwave: '"§square§"',
  }),
  phaser: { args: '§2§' },
  ...needs(`${DRUMS}.phaser(2)`, 'needs .phaser()', {
    phasersweep: '§2000§',
    phasercenter: '§1000§',
    phaserdepth: '§0.75§',
  }),
  tremolo: { args: '§4§' },
  tremolosync: { args: '§4§' },
  ...needs(`${SYNTH}.tremolosync(4)`, 'needs .tremolo() or .tremolosync()', {
    tremolodepth: '§0.8§',
    tremoloskew: '§0.5§',
    tremolophase: '§0.25§',
    tremoloshape: '"§tri§"',
  }),
  lfo: { args: '{ c: "lpf", r: §4§ }', base: `${SYNTH}.lpf(800)` },
  env: { args: '{ c: "lpf", a: §0.1§ }', base: `${SYNTH}.lpf(800)` },

  // Distortion
  distort: { args: '§1§' },
  ...needs(`${DRUMS}.distort(1)`, 'needs .distort()', { distortvol: '§0.8§', distorttype: '§1§' }),
  crush: { args: '§6§' },
  coarse: { args: '§4§' },
  shape: { args: '§0.4§' },
  ...needs(`${SYNTH}.lpf(500).ftype("ladder")`, 'needs .ftype("ladder")', { drive: '§2§' }),
  ...Object.fromEntries(
    ['soft', 'hard', 'cubic', 'diode', 'asym', 'fold', 'sinefold', 'chebyshev'].map((name) => [name, { args: '§1§' }]),
  ),

  // jux, ply, swingBy, struct, mask and euclid have no @name block in the five sources, so no row yet;
  // the build prints them as defaults with no catalogue row.

  // Pan and Space
  pan: { args: '§0.25§' },
  jux: { args: 'rev' },
  juxBy: { args: '§0.5§, rev' },
  spread: { args: '§0.5§', base: 'note("c3 e3 g3 c4").s("supersaw")', note: 'for s("supersaw")' },

  // Time
  off: { args: `§1/8§, ${CALLBACK}` },
  ply: { args: '§2§' },
  iter: { args: '§4§' },
  chop: { args: '§4§' },
  striate: { args: '§4§' },
  segment: { args: '§8§' },
  swingBy: { args: '§1/3§, 4' },
  ribbon: { args: '§1§, 2' },
  echo: { args: '§3§, 1/8, 0.8' },
  echoWith: { args: '§3§, 1/8, (p) => p.speed(1.5)' },
  stut: { args: '§3§, 0.8, 1/8' },
  plyWith: { args: '§2§, (p) => p.gain(0.8)' },
  plyForEach: { args: '§3§, (p, n) => p.speed(1 + n * 0.5)' },

  // Structure
  every: { args: '§4§, x => x.fast(2)' },
  firstOf: { args: '§4§, x => x.fast(2)' },
  lastOf: { args: '§4§, x => x.fast(2)' },
  when: { args: `"§<0 1>§", ${CALLBACK}` },
  within: { args: '0, §0.5§, x => x.fast(2)' },
  struct: { args: '"§x ~ x x§"' },
  mask: { args: '"§1 0 1 1§"' },
  euclid: { args: '§3§, 8' },
  chunk: { args: '§4§, x => x.fast(2)' },
  chunkBack: { args: '§4§, x => x.fast(2)' },
  fastChunk: { args: '§4§, x => x.fast(2)' },
  chunkInto: { args: '§4§, hurry(2)' },
  chunkBackInto: { args: '§4§, hurry(2)' },
  sometimesBy: { args: `§0.5§, ${CALLBACK}` },
  someCyclesBy: { args: `§0.5§, ${CALLBACK}` },
  ...Object.fromEntries(
    ['sometimes', 'someCycles', 'often', 'rarely', 'almostNever', 'almostAlways', 'never', 'always'].map((name) => [
      name,
      { args: CALLBACK },
    ]),
  ),
  // Four kicks all fall to degrade's coin in the first cycle; eight hats do not.
  degrade: { args: '', base: 's("hh*8").bank("tr909")' },
  degradeBy: { args: '§0.3§' },
  undegradeBy: { args: '§0.8§' },
  beat: { args: '"§0,7,10§", 16' },
  filter: { args: '(hap) => hap.value.s !== "hh"' },
  filterWhen: { args: '(t) => t % 1 < 0.5' },

  // Other
  layer: { args: 'x => x.fast(2)' },
  superimpose: { args: CALLBACK },
  apply: { args: 'x => x.fast(2)' },
  into: { args: '"§1 0§", hurry(2)' },
  mul: { args: 'speed(§1.5§)' },
  div: { args: 'speed(§2§)' },
  as: { args: '"§note:clip§"', base: '"c3:.5 e3:1 g3:.25 c4:.8"', note: 'needs a pattern of plain values, e.g. "c3:.5 e3:1"' },
  xfade: { args: '§0.5§, s("hh*8").bank("tr909")' },
  FX: { args: 'phaser(§2§)' },
  bus: { args: '§1§', note: 'heard through a pattern that plays s("bus")' },
  busgain: { args: '§0.8§', base: `${DRUMS}.bus(1)`, note: 'needs .bus()' },
  bmod: {
    args: '{ b: §1§, c: "lpf" }',
    base: `stack(s("one").seg(16).bus(1), ${SYNTH}.lpf(800))`,
    note: 'needs a pattern sending to that bus with .bus()',
  },
};
