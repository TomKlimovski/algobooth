import { createBoothState } from './boothState';
test('fader defaults to centre and knobs to lpf open, unity gain, no reverb', () => {
  const b = createBoothState();
  expect(b.state.fader).toBe(0.5);
  expect(b.state.knobs.A).toEqual({ lpf: 1, gain: 0.83, reverb: 0 });
});
test('setKnob clamps to [0,1]', () => {
  const b = createBoothState();
  b.setKnob('B', 'lpf', 1.7);
  expect(b.state.knobs.B.lpf).toBe(1);
});
