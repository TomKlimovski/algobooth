import { DECK_CONTROL, DECK_CONTROLS, MASTER_CONTROL, MASTER_CONTROLS } from './controlMap';

test('deck controls map [0,1] to lpf 200..20k Hz exponential, gain 0..1.2, reverb send 0..0.6', () => {
  expect(DECK_CONTROL.lpf(0)).toBeCloseTo(200);
  expect(DECK_CONTROL.lpf(0.5)).toBeCloseTo(2000);
  expect(DECK_CONTROL.lpf(1)).toBeCloseTo(20000);
  expect(DECK_CONTROL.gain(1)).toBeCloseTo(1.2);
  expect(DECK_CONTROL.reverb(1)).toBeCloseTo(0.6);
});

test('volume faders are linear 0..1 (unity at the top) on decks and master', () => {
  expect(DECK_CONTROL.volume(0)).toBe(0);
  expect(DECK_CONTROL.volume(1)).toBe(1);
  expect(DECK_CONTROL.volume(0.5)).toBe(0.5);
  expect(MASTER_CONTROL.volume(1)).toBe(1);
  expect('gain' in MASTER_CONTROL).toBe(false);
});

test('master adds a high-pass from 20 Hz (open) to 8 kHz, exponential', () => {
  expect(MASTER_CONTROL.hpf(0)).toBeCloseTo(20);
  expect(MASTER_CONTROL.hpf(1)).toBeCloseTo(8000);
  expect(MASTER_CONTROL.hpf(0.5)).toBeCloseTo(400);
  expect(MASTER_CONTROL.lpf(1)).toBeCloseTo(20000);
  expect(MASTER_CONTROL.reverb(1)).toBeCloseTo(0.6);
});

test('every listed control has a mapping and a default (the booth iterates these lists)', () => {
  for (const c of DECK_CONTROLS) expect(typeof DECK_CONTROL[c]).toBe('function');
  for (const c of MASTER_CONTROLS) expect(typeof MASTER_CONTROL[c]).toBe('function');
  expect(MASTER_CONTROLS).toEqual(['hpf', 'lpf', 'volume', 'reverb']);
  expect(DECK_CONTROLS).toEqual(['lpf', 'gain', 'reverb', 'volume']);
});
