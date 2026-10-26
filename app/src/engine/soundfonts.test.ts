import { fontIndex, midiOf, playbackRate } from './soundfonts';

test('midiOf reads freq, then a note name or number, else c3', () => {
  expect(midiOf({ freq: 440 })).toBe(69);
  expect(midiOf({ note: 'a4' })).toBe(69);
  expect(midiOf({ note: 60 })).toBe(60);
  expect(midiOf({})).toBe(48);
});

test('playbackRate is 1 at the zone pitch and doubles per octave', () => {
  expect(playbackRate({ pitch: 6000 }, 60)).toBe(1);
  expect(playbackRate({ pitch: 6000 }, 72)).toBeCloseTo(2);
  expect(playbackRate({ pitch: 6050 }, 60)).toBeCloseTo(Math.pow(2, -50 / 1200));
});

test('fontIndex wraps n like a sample index', () => {
  expect(fontIndex(undefined, 3)).toBe(0);
  expect(fontIndex(4, 3)).toBe(1);
  expect(fontIndex(-1, 3)).toBe(2);
  expect(fontIndex(1.7, 3)).toBe(1);
});
