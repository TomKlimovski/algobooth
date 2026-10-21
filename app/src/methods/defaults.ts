/** The Strudel sources the catalogue is built from, relative to node_modules/@strudel. */
export const SOURCES: string[] = [
  'core/controls.mjs',
  'core/pattern.mjs',
  'core/signal.mjs',
  'core/euclid.mjs',
  'core/repl.mjs',
  'core/pick.mjs',
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
  choose: 'reads the pattern it is called on as a 0..1 signal; on a sound pattern it picks nothing',
  choose2: 'reads the pattern it is called on as a -1..1 signal; on a sound pattern it picks nothing',
  pickmodF: 'plays nothing with any default tried (pickF works)',
  ...Object.fromEntries(
    ['pick', 'pickmod', 'pickOut', 'pickmodOut', 'pickRestart', 'pickmodRestart', 'pickReset', 'pickmodReset', 'inhabit', 'inhabitmod', 'squeeze'].map(
      (n) => [n, 'needs a pattern of indices to be chained onto; a drop lands on a sound pattern. pick() and squeeze() are offered as functions'],
    ),
  ),
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

/**
 * `args` is the argument text with the selectable literal between § signs. A function row may give `expr`
 * instead: the whole expression (a signal is an object, so `sine` needs `sine.range(§200§, 2000)`).
 */
type Default = { args?: string; expr?: string; base?: string; note?: string };

const SYNTH = 'note("c3 e3 g3 c4").s("sawtooth")';
const DRUMS = 's("bd*4").bank("tr909")';
const DUCK_NOTE = 'orbits here are decks: 1 = deck A, 2 = deck B';
const FOR_SYNTH = 'for s(...) synths, e.g. s("sawtooth")';
const MODULATES = 'needs a filter to modulate, e.g. .lpf()';
const NEEDS_NOTE = 'needs note(); silent on a drum deck';
const VOICING = { base: 'chord("<C^7 Dm7>")', note: 'needs a chord() pattern' };
const CALLBACK = 'x => x.speed(2)';
const CHORDS = { base: 'note("<[c3,e3,g3] [d3,f3,a3]>").s("sawtooth")', note: 'needs stacked notes, e.g. "[c,e,g]"' };

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
  // Combining, chained
  cat: { args: '§s("hh*8")§' },
  stack: { args: '§s("hh*8")§' },
  seq: { args: '§s("hh*8")§' },
  sequence: { args: '§s("hh*8")§' },
  slowcat: { args: '§s("hh*8")§' },
  pickF: { args: '"§0§ 1", [x => x.fast(2), x => x.rev()]', base: 's("bd*4")' },
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
  noise: { args: '§0.3§', base: SYNTH, note: FOR_SYNTH },
  density: { args: '§0.1§', base: 's("crackle*4")', note: 'for s("crackle")' },
  ...needs('note("c3 e3 g3 c4").s("pulse")', 'for s("pulse")', { pw: '§0.3§', pwrate: '§2§', pwsweep: '§0.3§' }),
  unison: { args: '§5§', base: 'note("c3 e3 g3 c4").s("supersaw")', note: 'for s("supersaw")' },
  partials: { args: '[1, 0.5, 0.3, 0.2]', base: SYNTH, note: FOR_SYNTH },
  phases: { args: '[0, 0.5, 0, 0.25]', base: SYNTH, note: FOR_SYNTH },
  ...needs('s("bytebeat")', 'for s("bytebeat")', {
    // Single quotes: a double-quoted string is mini-notation.
    byteBeatExpression: "'§t*(t>>15^t>>66)§'",
    byteBeatStartTime: '§10000§',
  }),

  // Pitch
  transpose: { args: '§7§', note: NEEDS_NOTE },
  scale: { args: '"§C:minor§"', note: NEEDS_NOTE },
  scaleTranspose: { args: '§2§', base: 'n("0 2 4 6").scale("C:minor").s("sawtooth")', note: 'needs a scale() pattern' },
  voicing: { args: '', ...VOICING },
  rootNotes: { args: '§2§', ...VOICING },
  add: { args: 'note(§12§)' },
  sub: { args: 'note(§12§)' },
  detune: { args: '§0.3§', base: 'note("c3 e3 g3 c4").s("supersaw")', note: 'for s("supersaw")' },
  vowel: { args: '"§a§"' },
  arp: { args: '"§0 [0,2] 1 [0,2]§"', ...CHORDS },
  arpWith: { args: '(haps) => haps[haps.length - 1]', ...CHORDS },
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
  ...needs(`${DRUMS}.duckorbit(2)`, `needs .duckorbit(); ${DUCK_NOTE}`, { duckattack: '§0.2§', duckdepth: '§0.8§', duckonset: '§0.01§' }),

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
  fmi: { args: '§4§', base: SYNTH, note: FOR_SYNTH },
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
  lfo: { args: '{ c: "lpf", r: §4§ }', base: `${SYNTH}.lpf(800)`, note: MODULATES },
  env: { args: '{ c: "lpf", a: §0.1§ }', base: `${SYNTH}.lpf(800)`, note: MODULATES },

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
  hurry: { args: '§2§' },
  linger: { args: '§0.25§' },
  compress: { args: '§0.25§, 0.75' },
  focus: { args: '§0.25§, 0.75' },
  zoom: { args: '§0.25§, 0.75' },
  bite: { args: '§4§, "0 2 1 3"' },
  pressBy: { args: '§0.25§' },
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
  euclidRot: { args: '§3§, 8, 2' },
  euclidLegato: { args: '§3§, 8' },
  euclidLegatoRot: { args: '§3§, 8, 2' },
  euclidish: { args: '§3§, 8, 0.5' },
  reset: { args: '"§x(3,8)§"' },
  restart: { args: '"§x(3,8)§"' },
  inside: { args: '§2§, rev' },
  outside: { args: '§2§, rev' },
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
  // bd*4 is one step, so dropping a step leaves nothing; four steps leave three.
  drop: { args: '"§1§"', base: 's("bd hh sd hh").bank("tr909")' },
  expand: { args: '§2§' },
  contract: { args: '§2§' },
  tour: { args: 's("§hh*2§").bank("tr909")' },
  bus: { args: '§1§', note: 'heard through a pattern that plays s("bus")' },
  busgain: { args: '§0.8§', base: `${DRUMS}.bus(1)`, note: 'needs .bus()' },
  bmod: {
    args: '{ b: §1§, c: "lpf" }',
    base: `stack(s("one").seg(16).bus(1), ${SYNTH}.lpf(800))`,
    note: 'needs a pattern sending to that bus with .bus()',
  },
};

const LIST = 'returns a plain list, not a pattern';
const META = 'measures event length; nothing to play';

/** Standalone functions the panel never offers: name → one-line reason. */
export const FUNCTION_DENY: Record<string, string> = {
  samples: 'loads samples from a URL; the app is offline and bundles its banks',
  silence: 'plays nothing; mute a line with an underscore instead',
  gap: 'plays nothing; mute a line with an underscore instead',
  nothing: 'plays nothing',
  K: 'the Kabelsalat engine, which the app does not run',
  useRNG: 'a global setting',
  addVoicings: 'a global setting',
  ref: 'needs a hand-written accessor',
  withSeed: 'takes a function',
  morph: 'takes binary lists; no sound of its own',
  parray: 'returns list-valued events; no sound of its own',
  binaryL: LIST,
  binaryNL: LIST,
  randL: LIST,
  time: 'the cycle count; not a usable modulation',
  cyclesPer: META,
  per: META,
  perx: META,
  mini: 'the mini-notation parser; a double-quoted string already is one',
  register: 'defines a new method; library code, not a pattern',
  sequenceP: 'library code: a pattern of lists',
};

// A continuous chooser has no events of its own: a pattern samples it.
const SAMPLED = { base: 's("hh*8").s({})', note: 'continuous: sample it from a pattern, e.g. s("hh*8").s(choose(...))' };
const TWO = 's("§bd*4§"), s("hh*8")';
// Continuous signals need a parameter to drive; a discrete n() or note() would need .segment().
const CONTINUOUS = 'continuous: drop it into .lpf(), .gain(), .pan()...; n() and note() need .segment(8) after it';
const UNIPOLAR = `${CONTINUOUS}; for a filter use .range(200, 2000)`;

/**
 * Function name → its expression (with § around the selectable literal), or its argument text; `base` is the
 * evaluate test's carrier with `{}` where the snippet goes, when the folder's carrier will not do.
 */
export const FUNCTION_DEFAULTS: Record<string, Default> = {
  // Combine
  stack: { args: `§s("bd*4")§, s("hh*8")` },
  seq: { args: TWO },
  sequence: { args: TWO },
  cat: { args: TWO },
  slowcat: { args: TWO },
  slowcatPrime: { args: TWO },
  arrange: { args: `[§4§, s("bd*4")], [2, s("hh*8")]` },
  seqPLoop: { args: `[§0§, 1, s("bd*4")], [1, 2, s("hh*8")]` },
  polymeter: { args: `s("§bd hh§"), s("sd sd sd")` },
  stepcat: { args: `[§3§, s("bd")], [1, s("hh")]` },
  timecat: { args: `[§3§, s("bd")], [1, s("hh")]` },
  stepalt: { args: `[s("§bd§"), s("hh")], [s("sd")]` },
  zip: { args: `s("§bd hh§"), s("sd cp")` },
  tour: { args: `s("§bd§"), s("hh"), s("sd")` },
  // Signals: a unit range, safe on gain or pan (the app has no limiter); the note gives the filter form
  ...Object.fromEntries(
    ['sine', 'cosine', 'saw', 'isaw', 'square', 'tri', 'itri', 'perlin', 'berlin'].map((n) => [
      n,
      { expr: `${n}.range(§0.2§, 1).slow(4)`, note: UNIPOLAR },
    ]),
  ),
  mousex: { expr: 'mousex.range(§0.2§, 1)', note: UNIPOLAR },
  mousey: { expr: 'mousey.range(§0.2§, 1)', note: UNIPOLAR },
  ...Object.fromEntries(
    ['sine2', 'cosine2', 'saw2', 'isaw2', 'square2', 'tri2', 'itri2'].map((n) => [
      n,
      { expr: `${n}.slow(§4§)`, note: `bipolar, -1 to 1: for .add() on a note, or .pan() after .range(0, 1); ${CONTINUOUS}` },
    ]),
  ),
  // Random
  rand: { expr: 'rand.range(§0.5§, 1)', note: CONTINUOUS },
  rand2: { expr: 'rand2.slow(§2§)', note: `bipolar, -1 to 1; ${CONTINUOUS}` },
  brand: { expr: 'brand.slow(§2§)', note: CONTINUOUS },
  brandBy: { args: '§0.3§', note: CONTINUOUS },
  irand: { args: '§8§', note: CONTINUOUS },
  choose: { args: '"§bd§", "hh", "sd"', ...SAMPLED },
  chooseCycles: { args: 's("§bd§"), s("hh"), s("sd")' },
  wchoose: { args: '["§bd§", 2], ["hh", 1]', ...SAMPLED },
  wchooseCycles: { args: '[s("§bd§"), 2], [s("hh"), 1]' },
  chooseWith: { args: 'sine, ["§bd§", "hh"]', ...SAMPLED },
  chooseInWith: { args: 'sine, [s("§bd§"), s("hh")]' },
  // Sources
  run: { args: '§8§', base: '$: n({}).s("hh")', note: 'numbers 0 to n-1: drop it into n()' },
  binary: { args: '§5§', base: '$: s("hh*8").struct({})', note: 'a rhythm of 1s and 0s: drop it into .struct()' },
  binaryN: { args: '§5§, 8', base: '$: s("hh*8").struct({})', note: 'a rhythm of 1s and 0s: drop it into .struct()' },
  pick: { args: '[s("bd*4"), s("hh*8")], "§0§ 1"' },
  squeeze: { args: '"§0§ 1", [s("bd*4"), s("hh*8")]' },
  // Setup: a repl global rather than a bundle export, so it is listed in FUNCTION_GROUP_OF to be offered
  setcpm: { args: '§120§/4', note: "replaces the deck's tempo line; deck B follows A while synced" },
};
