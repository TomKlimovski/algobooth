import { fillHall, REVERB_SECONDS } from './impulse';

const RATE = 8000;
const make = () => [new Float32Array(REVERB_SECONDS * RATE), new Float32Array(REVERB_SECONDS * RATE)];
const rms = (d: Float32Array, from: number, to: number) => Math.sqrt(d.slice(from, to).reduce((a, v) => a + v * v, 0) / (to - from));

test('the hall is silent for its predelay, then decays by about 60 dB over its length', () => {
  const [l, r] = make();
  fillHall([l, r], RATE);
  expect(l.slice(0, 100).every((v) => v === 0)).toBe(true);
  const early = rms(l, 400, 1200);
  const late = rms(l, l.length - 800, l.length);
  expect(20 * Math.log10(early / late)).toBeGreaterThan(40);
  expect(Math.max(...l.map(Math.abs), ...r.map(Math.abs))).toBeCloseTo(0.5);
});

test('the two channels are decorrelated, so the tail is wide', () => {
  const [l, r] = make();
  fillHall([l, r], RATE);
  let lr = 0;
  let ll = 0;
  let rr = 0;
  for (let i = 0; i < l.length; i++) {
    lr += l[i] * r[i];
    ll += l[i] * l[i];
    rr += r[i] * r[i];
  }
  expect(Math.abs(lr / Math.sqrt(ll * rr))).toBeLessThan(0.3);
});
