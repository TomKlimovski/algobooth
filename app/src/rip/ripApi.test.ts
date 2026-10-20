import { RipClient, STEM_NAMES, type JobStatus, type ModelStatus } from './ripApi';

interface Call { url: string; init: RequestInit | undefined }

function fakeFetch(respond: (url: string, init?: RequestInit) => Response) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return respond(url, init);
  }) as typeof fetch;
  return { calls, impl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const info = { port: 5000, token: 'tok' };
const auth = (c: Call) => new Headers(c.init?.headers).get('Authorization');

test('adds the bearer token and builds urls', async () => {
  const f = fakeFetch(() => json({ id: 'j1' }, 202));
  const client = new RipClient(info, f.impl);
  const req = { url: 'https://y.t/v', start: 72, end: 88, tidy: false };
  await expect(client.start(req)).resolves.toBe('j1');
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0].url).toBe('http://127.0.0.1:5000/rip');
  expect(f.calls[0].init?.method).toBe('POST');
  expect(auth(f.calls[0])).toBe('Bearer tok');
  expect(new Headers(f.calls[0].init?.headers).get('Content-Type')).toBe('application/json');
  expect(JSON.parse(String(f.calls[0].init?.body))).toEqual(req);
});

test('every call carries the token and hits its route', async () => {
  const job: JobStatus = { id: 'j', status: 'running', stage: 'download', progress: 0.5, result: null, error: null };
  const models: ModelStatus = {
    ready: true, torch_installed: true, weights_present: true, installing: false, stage: null, progress: 1, error: null,
  };
  const f = fakeFetch((url, init) => {
    if (url.endsWith('/rip/j') && init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.endsWith('/rip/j')) return json(job);
    if (url.endsWith('/models/install')) return json({}, 202);
    if (url.endsWith('/models')) return json(models);
    return json({ detail: 'nope' }, 404);
  });
  const client = new RipClient(info, f.impl);
  await expect(client.status('j')).resolves.toEqual(job);
  await expect(client.cancel('j')).resolves.toBeUndefined();
  await expect(client.models()).resolves.toEqual(models);
  await expect(client.installModels()).resolves.toBeUndefined();
  expect(f.calls.map((c) => [c.init?.method ?? 'GET', c.url])).toEqual([
    ['GET', 'http://127.0.0.1:5000/rip/j'],
    ['DELETE', 'http://127.0.0.1:5000/rip/j'],
    ['GET', 'http://127.0.0.1:5000/models'],
    ['POST', 'http://127.0.0.1:5000/models/install'],
  ]);
  for (const c of f.calls) expect(auth(c)).toBe('Bearer tok');
});

test('surfaces the server detail on errors', async () => {
  const conflict = new RipClient(info, fakeFetch(() => json({ detail: 'a rip is already running' }, 409)).impl);
  await expect(conflict.start({ url: 'https://x', start: 0, end: 5, tidy: false })).rejects.toThrow(
    new Error('a rip is already running'),
  );
  const broken = new RipClient(info, fakeFetch(() => new Response('Internal Server Error', { status: 500 })).impl);
  await expect(broken.status('j')).rejects.toThrow(new Error('HTTP 500'));
  // FastAPI's 422 detail is a list; it is not a string, so the status is shown instead.
  const invalid = new RipClient(info, fakeFetch(() => json({ detail: [{ msg: 'bad' }] }, 422)).impl);
  await expect(invalid.start({ url: 'https://x', start: 0, end: 5, tidy: false })).rejects.toThrow(new Error('HTTP 422'));
});

test('stem returns the bytes', async () => {
  const bytes = new Uint8Array([82, 73, 70, 70]);
  const f = fakeFetch(() => new Response(bytes, { status: 200, headers: { 'Content-Type': 'audio/wav' } }));
  const client = new RipClient(info, f.impl);
  const buf = await client.stem('j', 'drums');
  expect(f.calls[0].url).toBe('http://127.0.0.1:5000/rip/j/stem/drums');
  expect(auth(f.calls[0])).toBe('Bearer tok');
  expect(buf).toBeInstanceOf(ArrayBuffer);
  expect(Array.from(new Uint8Array(buf))).toEqual([82, 73, 70, 70]);
});

test('stem names', () => {
  expect(STEM_NAMES).toEqual(['drums', 'bass', 'other', 'vocals', 'mix']);
});
