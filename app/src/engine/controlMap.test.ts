import { DECK_CONTROL, MASTER_CONTROL } from './controlMap';

test('deck controls map [0,1] to lpf 200..20k Hz exponential, gain 0..1.2, reverb send 0..0.6', () => {
  expect(DECK_CONTROL.lpf(0)).toBeCloseTo(200);
  expect(DECK_CONTROL.lpf(0.5)).toBeCloseTo(2000);
  expect(DECK_CONTROL.lpf(1)).toBeCloseTo(20000);
  expect(DECK_CONTROL.gain(1)).toBeCloseTo(1.2);
  expect(DECK_CONTROL.reverb(1)).toBeCloseTo(0.6);
});

test('master adds a high-pass from 20 Hz (open) to 8 kHz, exponential', () => {
  expect(MASTER_CONTROL.hpf(0)).toBeCloseTo(20);
  expect(MASTER_CONTROL.hpf(1)).toBeCloseTo(8000);
  expect(MASTER_CONTROL.hpf(0.5)).toBeCloseTo(400);
  expect(MASTER_CONTROL.lpf(1)).toBeCloseTo(20000);
  expect(MASTER_CONTROL.gain(1)).toBeCloseTo(1.2);
  expect(MASTER_CONTROL.reverb(1)).toBeCloseTo(0.6);
});
