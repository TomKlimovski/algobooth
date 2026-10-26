/** Reverb length: the tail is 60 dB down here. */
export const REVERB_SECONDS = 2.4;
/** The gap before the tail starts, which keeps the dry hit clear of its own reverb. */
const PREDELAY = 0.015;
/** The fade-in of the tail, so the reverb blooms rather than clicks. */
const ONSET = 0.02;
/** One-pole lowpass cutoffs at the tail's start and end: a hall darkens as it dies, white noise does not. */
const BRIGHT_HZ = 9000;
const DARK_HZ = 1200;

/**
 * Fills `channels` with a hall-like impulse: decorrelated noise per channel (so the tail is wide), an exponential
 * decay to -60 dB at `REVERB_SECONDS`, and a lowpass that closes from bright to dark along the tail.
 * `random` is injectable so a test can pin it.
 */
export function fillHall(channels: Float32Array[], sampleRate: number, random: () => number = Math.random): void {
  const length = channels[0]?.length ?? 0;
  const start = Math.round(PREDELAY * sampleRate);
  const onset = ONSET * sampleRate;
  const tail = Math.max(1, length - start);
  // exp(-6.91) is -60 dB.
  const decay = 6.91 / tail;
  for (const data of channels) {
    let lp = 0;
    data.fill(0, 0, Math.min(start, length));
    for (let i = start; i < length; i++) {
      const t = (i - start) / tail;
      const cutoff = BRIGHT_HZ * Math.pow(DARK_HZ / BRIGHT_HZ, t);
      const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
      lp += a * (random() * 2 - 1 - lp);
      const fadeIn = Math.min(1, (i - start) / onset);
      data[i] = lp * Math.exp(-decay * (i - start)) * fadeIn;
    }
  }
  // Normalise so the reverb's level does not depend on the lowpass: the loudest sample is 0.5.
  let peak = 0;
  for (const data of channels) for (const v of data) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (const data of channels) for (let i = 0; i < length; i++) data[i] *= 0.5 / peak;
}

/** A stereo hall impulse for a ConvolverNode on `ac`. */
export function hallImpulse(ac: BaseAudioContext): AudioBuffer {
  const length = Math.round(REVERB_SECONDS * ac.sampleRate);
  const buffer = ac.createBuffer(2, length, ac.sampleRate);
  fillHall([buffer.getChannelData(0), buffer.getChannelData(1)], ac.sampleRate);
  return buffer;
}
