import { crossfadeGains } from './crossfade';

test('a narrow centre plateau keeps both decks at full gain', () => {
  expect(crossfadeGains(0.5)).toEqual([1, 1]);
  expect(crossfadeGains(0.45)).toEqual([1, 1]);
  expect(crossfadeGains(0.55)).toEqual([1, 1]);
});

test('ends are exclusive', () => {
  expect(crossfadeGains(0)).toEqual([1, 0]);
  expect(crossfadeGains(1)).toEqual([0, 1]);
});

test('the first fifth of travel already cuts the far deck by more than 6 dB', () => {
  const [a, b] = crossfadeGains(0.2);
  expect(a).toBe(1);
  expect(b).toBeLessThan(0.5);
  expect(b).toBeGreaterThan(0.2);
});

test('taper is a squared sine of the distance from the plateau, symmetric both ways', () => {
  const t = (0.8 - 0.55) / 0.45;
  const expected = Math.pow(Math.cos((t * Math.PI) / 2), 2);
  expect(crossfadeGains(0.8)).toEqual([expect.closeTo(expected, 6), 1]);
  expect(crossfadeGains(0.2)).toEqual([1, expect.closeTo(expected, 6)]);
});
