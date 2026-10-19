import { cpmFromCps, createDeckState } from './deckState';
test('eval error is stored per deck and cleared on next successful eval', () => {
  const d = createDeckState('A');
  d.setError('SyntaxError: x');
  expect(d.state.error).toBe('SyntaxError: x');
  d.setError(null);
  expect(d.state.error).toBeNull();
});
test('cpm defaults to 120 and orbit is fixed per deck', () => {
  expect(createDeckState('B').state.cpm).toBe(120);
});
test('an error on one deck does not touch the other', () => {
  const a = createDeckState('A'); const b = createDeckState('B');
  a.setError('boom');
  expect(b.state.error).toBeNull();
});
test('header cpm is the bpm figure written in setcpm(bpm/4)', () => {
  expect(cpmFromCps(120 / 4 / 60)).toBe(120);
  expect(cpmFromCps(126 / 4 / 60)).toBe(126);
});
