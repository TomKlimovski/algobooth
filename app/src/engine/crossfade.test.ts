import { crossfadeGains } from './crossfade';
test('centre plateau keeps both decks at full gain', () => {
  expect(crossfadeGains(0.5)).toEqual([1, 1]);
  expect(crossfadeGains(0.4)).toEqual([1, 1]);
  expect(crossfadeGains(0.6)).toEqual([1, 1]);
});
test('ends are exclusive', () => {
  expect(crossfadeGains(0)).toEqual([1, 0]);
  expect(crossfadeGains(1)).toEqual([0, 1]);
});
test('taper is equal power outside the plateau', () => {
  const [a, b] = crossfadeGains(0.8);
  expect(a).toBeCloseTo(Math.cos((0.8 - 0.6) / 0.4 * Math.PI / 2), 5);
  expect(b).toBe(1);
});
