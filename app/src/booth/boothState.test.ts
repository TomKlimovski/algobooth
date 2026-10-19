import { createBoothState } from './boothState';
test('fader defaults to centre and knobs to lpf open, unity gain, no reverb', () => {
  const b = createBoothState();
  expect(b.state.fader).toBe(0.5);
  expect(b.state.knobs.A).toEqual({ lpf: 1, gain: 0.83, reverb: 0, volume: 1 });
});
test('setKnob clamps to [0,1]', () => {
  const b = createBoothState();
  b.setKnob('B', 'lpf', 1.7);
  expect(b.state.knobs.B.lpf).toBe(1);
});
test('sync starts released with no message', () => {
  const b = createBoothState();
  expect(b.state.sync).toBe(false);
  expect(b.state.message).toBeNull();
  b.setSync(true);
  b.setMessage('Start deck A first');
  expect(b.state.sync).toBe(true);
  expect(b.state.message).toBe('Start deck A first');
});
test('master defaults: filters open, unity gain, dry; setMaster clamps', () => {
  const b = createBoothState();
  expect(b.state.master).toEqual({ hpf: 0, lpf: 1, volume: 1, reverb: 0 });
  b.setMaster('hpf', -2);
  b.setMaster('reverb', 1.5);
  expect(b.state.master.hpf).toBe(0);
  expect(b.state.master.reverb).toBe(1);
});
