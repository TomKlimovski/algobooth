import { vi } from 'vitest';

const webaudio = vi.hoisted(() => ({
  initAudio: vi.fn(async () => {}),
  registerSynthSounds: vi.fn(),
  samples: vi.fn(async () => {}),
  aliasBank: vi.fn(async () => {}),
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
  const fetch = vi.fn(async () => respond(404, 'Not Found'));
  vi.stubGlobal('fetch', fetch);
  await expect(initEngine()).rejects.toThrow(SAMPLES_HINT);
  expect(fetch).toHaveBeenCalledTimes(1);

  fetch.mockImplementation(async () => respond(200, '{"bd":["bd.wav"]}'));
  await expect(initEngine()).resolves.toBeUndefined();
  expect(webaudio.samples).toHaveBeenCalledWith({ bd: ['bd.wav'] }, expect.stringContaining('/samples/tidal-drum-machines/'), {
    prebake: true,
    tag: 'drum-machines',
  });
  await initEngine();
  expect(fetch).toHaveBeenCalledTimes(2); // a successful boot is cached
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
