// `pnpm build-methods` prints the names that fall into Other. At Strudel 1.2.6 they are:
// apply, as, bmod, bus, busgain, div, FX, into, layer, mul, superimpose, xfade, and the experimental
// stepwise functions contract, drop, expand, extend, grow, pace, replicate, shrink, take, tour.

/** The Methods panel's folders, in panel order; anything not in GROUP_OF goes to Other. */
export const GROUPS = [
  'Sound',
  'Pitch',
  'Filter',
  'Envelope',
  'Dynamics',
  'Ducking',
  'Delay and Reverb',
  'Modulation',
  'Distortion',
  'Pan and Space',
  'Time',
  'Structure',
  'Other',
];

const MEMBERS: Record<string, string[]> = {
  Sound: [
    's', 'bank', 'n', 'note', 'clip', 'duration', 'begin', 'end', 'speed', 'stretch', 'loopAt', 'loopAtCps', 'fit',
    'cut', 'loop', 'loopBegin', 'loopEnd', 'slice', 'splice', 'scrub', 'noise', 'density',
    'pw', 'pwrate', 'pwsweep', 'unison', 'partials', 'phases', 'byteBeatExpression', 'byteBeatStartTime',
  ],
  Pitch: [
    'transpose', 'scale', 'scaleTranspose', 'voicing', 'rootNotes', 'arp', 'arpWith', 'add', 'sub', 'detune', 'vowel',
    'octave', 'freq', 'penv', 'pattack', 'pdecay', 'prelease', 'pcurve', 'panchor',
  ],
  Filter: [
    'lpf', 'lpq', 'lpenv', 'lpattack', 'lpdecay', 'lpsustain', 'lprelease',
    'lprate', 'lpsync', 'lpdepth', 'lpdepthfrequency', 'lpshape', 'lpdc', 'lpskew',
    'hpf', 'hpq', 'hpenv', 'hpattack', 'hpdecay', 'hpsustain', 'hprelease',
    'hprate', 'hpsync', 'hpdepth', 'hpdepthfrequency', 'hpshape', 'hpdc', 'hpskew',
    'bpf', 'bpq', 'bpenv', 'bpattack', 'bpdecay', 'bpsustain', 'bprelease',
    'bprate', 'bpsync', 'bpdepth', 'bpdepthfrequency', 'bpshape', 'bpdc', 'bpskew',
    'ftype', 'fanchor', 'djf',
  ],
  Envelope: ['attack', 'decay', 'sustain', 'release', 'adsr'],
  Dynamics: ['gain', 'velocity', 'postgain', 'compressor', 'transient'],
  Ducking: ['orbit', 'duckorbit', 'duckattack', 'duckdepth', 'duckonset'],
  'Delay and Reverb': [
    'delay', 'delayfeedback', 'delayspeed', 'delaysync',
    'room', 'roomsize', 'roomlp', 'roomdim', 'roomfade', 'iresponse', 'irspeed', 'irbegin',
  ],
  Modulation: [
    'vib', 'vibmod', 'fmi', 'fmh', 'fmenv', 'fmattack', 'fmdecay', 'fmsustain', 'fmrelease', 'fmwave',
    'phaser', 'phasersweep', 'phasercenter', 'phaserdepth',
    'tremolo', 'tremolosync', 'tremolodepth', 'tremoloskew', 'tremolophase', 'tremoloshape',
    'chorus', 'lfo', 'env',
  ],
  Distortion: [
    'distort', 'distortvol', 'distorttype', 'crush', 'coarse', 'shape', 'drive',
    'soft', 'hard', 'cubic', 'diode', 'asym', 'fold', 'sinefold', 'chebyshev',
  ],
  'Pan and Space': ['pan', 'jux', 'juxBy', 'spread'],
  Time: [
    'fast', 'slow', 'fastGap', 'early', 'late', 'rev', 'revv', 'off', 'iter', 'iterBack', 'segment', 'repeatCycles',
    'ribbon', 'chop', 'striate', 'echo', 'echoWith', 'stut', 'ply', 'plyWith', 'plyForEach', 'shuffle', 'scramble',
    'hurry', 'swingBy', 'swing', 'palindrome', 'linger', 'compress', 'focus', 'zoom', 'bite', 'brak', 'press', 'pressBy',
  ],
  Structure: [
    'every', 'firstOf', 'lastOf', 'when', 'within', 'struct', 'mask', 'euclid', 'euclidRot', 'euclidLegato',
    'euclidLegatoRot', 'euclidish', 'reset', 'restart', 'inside', 'outside', 'chunk', 'chunkBack', 'fastChunk', 'chunkInto', 'chunkBackInto',
    'sometimes', 'sometimesBy', 'someCycles', 'someCyclesBy', 'often', 'rarely', 'almostNever', 'almostAlways',
    'never', 'always', 'degrade', 'degradeBy', 'undegrade', 'undegradeBy', 'seed', 'beat', 'filter', 'filterWhen',
    'cat', 'pickF', 'stack', 'seq', 'sequence', 'slowcat', 'tour',
  ],
};

/** Method name → its folder. */
export const GROUP_OF: Record<string, string> = Object.fromEntries(
  Object.entries(MEMBERS).flatMap(([group, names]) => names.map((name) => [name, group])),
);

/** The Functions section's folders, in panel order; anything not in FUNCTION_GROUP_OF goes to Other. */
export const FUNCTION_GROUPS = ['Combine', 'Signals', 'Random', 'Sources', 'Setup', 'Other'];

/**
 * Standalone functions by folder. A name here is offered as a function even when it is also a method
 * (stack, seq, cat...: both uses are real); a documented name that is not a method is offered without
 * being listed, in Other.
 */
const FUNCTION_MEMBERS: Record<string, string[]> = {
  Combine: [
    'stack', 'seq', 'sequence', 'cat', 'slowcat', 'slowcatPrime', 'arrange', 'seqPLoop', 'polymeter', 'stepcat', 'timecat',
    'stepalt', 'zip', 'tour',
  ],
  Signals: [
    'sine', 'sine2', 'cosine', 'cosine2', 'saw', 'saw2', 'isaw', 'isaw2', 'square', 'square2', 'tri', 'tri2', 'itri',
    'itri2', 'perlin', 'berlin', 'mousex', 'mousey',
  ],
  Random: [
    'rand', 'rand2', 'brand', 'brandBy', 'irand', 'choose', 'chooseCycles', 'wchoose', 'wchooseCycles',
    'chooseWith', 'chooseInWith',
  ],
  Sources: ['run', 'binary', 'binaryN', 'pick', 'squeeze'],
  Setup: ['setcpm'],
};

/** Function name → its folder. */
export const FUNCTION_GROUP_OF: Record<string, string> = Object.fromEntries(
  Object.entries(FUNCTION_MEMBERS).flatMap(([group, names]) => names.map((name) => [name, group])),
);
