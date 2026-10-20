import type { Analysis } from './ripApi';
import { abGains, Audition, loopBounds } from './audition';

const analysis = (over: Partial<Analysis> = {}): Analysis => ({
  bpm: 120, key: 'A minor', meter: '4/4', bars: 8, steps_per_bar: 16, first_downbeat: 0,
  drums: {}, four_on_the_floor: true, bass: [], bass_harmonics: 0, chords: [], melody: null,
  ...over,
});

/** The slice of an AudioContext that Audition touches, with every node recorded. */
function fakeContext() {
  const sources: any[] = [];
  const gains: any[] = [];
  const ctx = {
    currentTime: 0,
    destination: { name: 'destination' },
    decodeAudioData: vi.fn(async (bytes: ArrayBuffer) => ({ duration: 16, bytes })),
    createBufferSource: vi.fn(() => {
      const s = {
        buffer: null as unknown,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        onended: null as null | (() => void),
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(() => s.onended?.()),
        disconnect: vi.fn(),
      };
      sources.push(s);
      return s;
    }),
    createGain: vi.fn(() => {
      const g = { gain: { value: 1, setTargetAtTime: vi.fn() }, connect: vi.fn() };
      gains.push(g);
      return g;
    }),
  };
  return { ctx: ctx as unknown as AudioContext, raw: ctx, sources, gains };
}

test('ab gains are exclusive', () => {
  expect(abGains('original')).toEqual({ original: 1, result: 0 });
  expect(abGains('result')).toEqual({ original: 0, result: 1 });
});

test('loop bounds cover whole bars from the first downbeat', () => {
  expect(loopBounds(analysis({ bpm: 120, bars: 4, first_downbeat: 0.5 }))).toEqual({ start: 0.5, end: 8.5 });
});

test('play stops the previous source and starts the new one with loop points', async () => {
  const { ctx, raw, sources, gains } = fakeContext();
  const a = new Audition(() => ctx);
  const drums = new ArrayBuffer(4);
  await a.load('drums', drums);
  await a.load('bass', new ArrayBuffer(8));
  expect(raw.decodeAudioData).toHaveBeenCalledWith(drums);
  expect(a.playing()).toBeNull();

  a.play('drums', { start: 0.5, end: 8.5 });
  expect(sources).toHaveLength(1);
  const first = sources[0];
  expect(first.buffer).toEqual({ duration: 16, bytes: drums });
  expect(first).toMatchObject({ loop: true, loopStart: 0.5, loopEnd: 8.5 });
  expect(first.start).toHaveBeenCalledWith(0, 0.5);
  expect(gains).toHaveLength(1);
  expect(first.connect).toHaveBeenCalledWith(gains[0]);
  expect(gains[0].connect).toHaveBeenCalledWith(raw.destination);
  expect(a.playing()).toBe('drums');

  a.play('bass');
  expect(first.stop).toHaveBeenCalled();
  const second = sources[1];
  expect(second.loop).toBe(false);
  expect(second.loopStart).toBe(0);
  expect(second.start).toHaveBeenCalledWith(0, 0);
  expect(gains).toHaveLength(1); // one gain node for every source
  expect(a.playing()).toBe('bass'); // the first source's late `ended` must not clear it

  a.stop();
  expect(second.stop).toHaveBeenCalled();
  expect(a.playing()).toBeNull();
});

test('setGain ramps the shared gain and is remembered before the first play', async () => {
  const { ctx, gains } = fakeContext();
  const a = new Audition(() => ctx);
  a.setGain(0);
  await a.load('mix', new ArrayBuffer(1));
  a.play('mix');
  expect(gains[0].gain.value).toBe(0);
  a.setGain(1);
  expect(gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, expect.any(Number));
});

test('play of a stem that is not loaded does nothing', () => {
  const { ctx, sources } = fakeContext();
  const a = new Audition(() => ctx);
  a.play('vocals');
  expect(sources).toHaveLength(0);
  expect(a.playing()).toBeNull();
});
