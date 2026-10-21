import { expect, test } from 'vitest';
import { exampleArgument, parseJsdocBlocks } from './parseJsdoc';

const FIXTURE = `
export const { duckonset } = registerControl('duckonset', 'duckons');

/**
 * The time required for the ducked signal(s) to return to their normal volume.
 *
 * Can vary across orbits with the ':' mininotation, e.g. \`duckonset("0:0.003")\`.
 * Note: this requires first applying the effect to multiple orbits with e.g. \`duckorbit("2:3")\`.
 *
 * @name duckattack
 * @synonyms duckatt
 *
 * @param {number | Pattern} time The attack time in seconds
 * @example
 * sound: n(run(8)).scale("c:minor").s("sawtooth").delay(.7).orbit(2)
 * ducker: s("bd:4!4").beat("0,4,8,11,14",16).duckorbit(2).duckattack("<0.2 0 0.4>").duckdepth(1)
 * @example
 * moreduck: n(run(8)).scale("c:minor").s("sawtooth").delay(.7).orbit(2)
 * ducker: s("bd:4!4").duckattack("0.4:0.1")
 *
 */
export const { duckattack } = registerControl('duckattack', 'duckatt');

/**
 * Reverses the pattern.
 *
 * @name rev
 * @memberof Pattern
 * @example
 * s("bd hh").rev()
 */
Pattern.prototype.rev = function () {};

/**
 * Hidden helper.
 * @noAutocomplete
 */
export const hidden = 1;
`;

test('parses name, synonyms, first paragraph, params and first example', () => {
  const [duck, rev] = parseJsdocBlocks(FIXTURE);
  expect(duck.name).toBe('duckattack');
  expect(duck.synonyms).toEqual(['duckatt']);
  expect(duck.description).toBe('The time required for the ducked signal(s) to return to their normal volume.');
  expect(duck.params).toEqual([{ name: 'time', type: 'number | Pattern', description: 'The attack time in seconds' }]);
  expect(duck.example).toContain('duckattack("<0.2 0 0.4>")');
  expect(duck.example).not.toContain('moreduck');
  expect(rev.memberof).toBe('Pattern');
  expect(rev.params).toEqual([]);
});

test('a block without @name takes its name from the code line after it', () => {
  const names = (source: string) => parseJsdocBlocks(source).map((b) => b.name);
  expect(names("/** Repeats each event.\n * @example\n * s(\"bd\").ply(2)\n */\nexport const ply = register('ply', function (factor, pat) {});")).toEqual(['ply']);
  expect(names("/** Rotated euclid. */\nexport const { euclidrot, euclidRot } = register(['euclidrot', 'euclidRot'], f);")).toEqual(['euclidrot']);
  expect(names('/** Applies the given structure. */\n  Pattern.prototype.struct = function (...args) {};')).toEqual(['struct']);
  expect(names('/** A sawtooth signal. */\nexport const saw = signal((t) => t % 1);')).toEqual(['saw']);
  expect(names('/** Plays the pattern. */\n\nPattern.prototype.play = function () {};')).toEqual(['play']); // blank lines skipped
});

test('a lone *Experimental* label does not stand in for the description', () => {
  const [pace] = parseJsdocBlocks('/**\n * *Experimental*\n *\n * Speeds a pattern up or down.\n * @example\n * s("bd").pace(4)\n */\nexport const pace = register(\'pace\', f);');
  expect(pace.description).toBe('*Experimental* Speeds a pattern up or down.');
});

test('a block with neither @name nor a recognised code line is skipped, and tags are collected', () => {
  expect(parseJsdocBlocks('/** A class method. */\n  withValue(func) {\n  }')).toHaveLength(0);
  expect(parseJsdocBlocks('/** At the end. */')).toHaveLength(0);
  expect(parseJsdocBlocks(FIXTURE).map((b) => b.name)).toEqual(['duckattack', 'rev', 'hidden']);
  expect(parseJsdocBlocks('/**\n * x\n * @name foo\n * @superdirtOnly\n */')[0].tags.has('superdirtOnly')).toBe(true);
});

test('exampleArgument takes one literal and refuses anything else', () => {
  expect(exampleArgument('s("bd").lpf(800)', 'lpf')).toBe('800');
  expect(exampleArgument('n(1).lpenv(8).lpf(150)', 'lpenv')).toBe('8');
  expect(exampleArgument('s("bd").duckattack("<0.2 0 0.4>")', 'duckattack')).toBe('"<0.2 0 0.4>"');
  expect(exampleArgument('s("bd").euclid(3,8)', 'euclid')).toBeNull();
  expect(exampleArgument('s("bd").off(1/8, x => x)', 'off')).toBeNull();
  expect(exampleArgument('s("bd").rev()', 'rev')).toBeNull();
  expect(exampleArgument('s("bd").lpfx(1)', 'lpf')).toBeNull();
});
