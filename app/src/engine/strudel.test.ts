import { vi } from 'vitest';

const webaudio = vi.hoisted(() => ({
  initAudio: vi.fn(async () => {}),
  registerSynthSounds: vi.fn(),
  samples: vi.fn(async () => {}),
  aliasBank: vi.fn(async () => {}),
  registerSound: vi.fn(),
  getAudioContext: () => ({ close: vi.fn(async () => {}) }),
}));
vi.mock('@strudel/webaudio', () => webaudio);
vi.mock('@strudel/core', () => ({ evalScope: vi.fn(async () => {}) }));
vi.mock('@strudel/codemirror', () => ({ sliderWithID: () => 0 }));
vi.mock('@strudel/mini', () => ({}));
vi.mock('@strudel/tonal', () => ({}));
vi.mock('@strudel/draw', () => ({}));

const { initEngine, SAMPLES_HINT, SCOPE_MODULES } = await import('./strudel');

const respond = (status: number, body: string) => new Response(body, { status });

afterEach(() => vi.unstubAllGlobals());

test('a failed boot is not cached: the next call boots again', async () => {
  const fetch = vi.fn(async (_url: string) => respond(404, 'Not Found'));
  vi.stubGlobal('fetch', fetch);
  await expect(initEngine()).rejects.toThrow(SAMPLES_HINT);

  const zone = { low: 0, high: 127, pitch: 6000, loopStart: 0, loopEnd: 0, sampleRate: 44100, file: 'f/0.mp3' };
  const bodies: Record<string, unknown> = {
    'tidal-drum-machines.json': { bd: ['bd.wav'] },
    'piano.json': { piano: { C4: 'C4v8.mp3' } },
    'dirt.json': { house: ['house/0.wav'] },
    'soundfonts.json': { gm_epiano1: [[zone]] },
  };
  fetch.mockImplementation(async (url: string) => respond(200, JSON.stringify(bodies[url.split('/').pop()!])));
  await expect(initEngine()).resolves.toBeUndefined();
  expect(webaudio.samples).toHaveBeenCalledWith({ bd: ['bd.wav'] }, expect.stringContaining('/samples/tidal-drum-machines/'), {
    prebake: true,
    tag: 'drum-machines',
  });
  expect(webaudio.samples).toHaveBeenCalledWith(bodies['piano.json'], expect.stringContaining('/samples/piano/'), { prebake: true, tag: 'piano' });
  expect(webaudio.samples).toHaveBeenCalledWith(bodies['dirt.json'], expect.stringContaining('/samples/dirt/'), { prebake: true, tag: 'dirt' });
  expect(webaudio.registerSound).toHaveBeenCalledWith('gm_epiano1', expect.any(Function), { type: 'soundfont', prebake: true, fonts: 1 });
  const calls = fetch.mock.calls.length;
  await initEngine();
  expect(fetch).toHaveBeenCalledTimes(calls); // a successful boot is cached
});

test('the editor package is in the eval scope, so `slider(...)` resolves to sliderWithID', () => {
  expect(SCOPE_MODULES.some((m) => 'sliderWithID' in m)).toBe(true);
});

test('a manifest that is not JSON (a dev-server fallback page) also gets the hint', async () => {
  // A fresh module: the previous test cached a successful boot.
  vi.resetModules();
  const fresh = await import('./strudel');
  vi.stubGlobal('fetch', vi.fn(async () => respond(200, '<!doctype html>')));
  await expect(fresh.initEngine()).rejects.toThrow(fresh.SAMPLES_HINT);
});
