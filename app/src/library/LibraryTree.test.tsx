import { render } from 'solid-js/web';
import type { DeckApi } from '../booth/Deck';
import type { LibraryApi, Pattern, TreeNode } from './api';
import { LibraryTree, PREVIEW_DELAY_MS } from './LibraryTree';
import { createLibraryStore } from './store';

const heading = (path: string, children: TreeNode[] = []): TreeNode => ({ name: path || 'library', path, kind: 'heading', cpm: null, children });
const leaf = (path: string): TreeNode => ({ name: path.replace(/\.json$/, ''), path, kind: 'pattern', cpm: 120, children: [] });
const pattern = (code: string): Pattern => ({ name: 'x', code, cpm: 120, key: '', tags: [], source: { kind: 'mine' }, notes: '' });

function fakeApi(tree: TreeNode, code = 'setcpm(120/4)\n$: s("bd*4")') {
  return {
    list_tree: vi.fn(async () => tree),
    read_pattern: vi.fn(async () => pattern(code)),
    write_pattern: vi.fn(async () => ''), save_pattern: vi.fn(async () => {}), create_heading: vi.fn(async () => ''),
    rename_entry: vi.fn(async () => ''), move_entry: vi.fn(async () => ''), delete_entry: vi.fn(async () => {}),
    ensure_library: vi.fn(async () => {}), watch_library: vi.fn(async () => {}), onLibraryChanged: vi.fn(async () => () => {}),
  } satisfies LibraryApi;
}

let dispose = () => {};
let root: HTMLDivElement;
const flush = () => new Promise((r) => setTimeout(r, 0));
const row = (name: string) => [...root.querySelectorAll('.lib-row')].find((r) => r.textContent?.includes(name)) as HTMLElement;

async function mount(api: LibraryApi, decks: Record<'A' | 'B', DeckApi | null> = { A: null, B: null }) {
  const store = createLibraryStore(api, () => decks);
  await store.refresh();
  root = document.createElement('div');
  document.body.append(root);
  dispose = render(() => <LibraryTree store={store} />, root);
  return store;
}
afterEach(() => {
  dispose();
  root.remove();
  vi.useRealTimers();
});

test('resting the pointer on a pattern shows its code; leaving hides it', async () => {
  const api = fakeApi(heading('', [leaf('kick.json')]));
  await mount(api);
  vi.useFakeTimers();
  row('kick').dispatchEvent(new MouseEvent('mouseenter'));
  expect(root.querySelector('.lib-preview')).toBeNull();
  await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS + 1);
  expect(root.querySelector('.lib-preview')?.textContent).toBe('setcpm(120/4)\n$: s("bd*4")');
  expect(api.read_pattern).toHaveBeenCalledWith('kick.json');
  row('kick').dispatchEvent(new MouseEvent('mouseleave'));
  expect(root.querySelector('.lib-preview')).toBeNull();
});

test('a pointer that moves on before the delay shows nothing, and headings never preview', async () => {
  const api = fakeApi(heading('', [heading('mine', [leaf('mine/kick.json')])]));
  await mount(api);
  vi.useFakeTimers();
  row('kick').dispatchEvent(new MouseEvent('mouseenter'));
  await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS / 2);
  row('kick').dispatchEvent(new MouseEvent('mouseleave'));
  await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
  expect(root.querySelector('.lib-preview')).toBeNull();
  expect(api.read_pattern).not.toHaveBeenCalled();
  row('mine').dispatchEvent(new MouseEvent('mouseenter'));
  await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS + 1);
  expect(root.querySelector('.lib-preview')).toBeNull();
});

test('a long pattern is cut to its first lines', async () => {
  const api = fakeApi(heading('', [leaf('long.json')]), Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'));
  await mount(api);
  vi.useFakeTimers();
  row('long').dispatchEvent(new MouseEvent('mouseenter'));
  await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS + 1);
  const text = root.querySelector('.lib-preview')!.textContent!;
  expect(text.split('\n')).toHaveLength(15);
  expect(text.endsWith('…')).toBe(true);
});

test('double-click loads into the target deck and hides the preview', async () => {
  const api = fakeApi(heading('', [leaf('kick.json')]));
  const deck = (id: 'A' | 'B') =>
    ({ id, setCode: vi.fn(), setName: vi.fn(), setFile: vi.fn(), filePath: () => null, moveFile: vi.fn(), isDirty: () => false, save: vi.fn(), scheduler: { started: false } }) as unknown as DeckApi;
  const A = deck('A');
  const B = deck('B');
  const store = await mount(api, { A, B });
  store.setTarget('B');
  row('kick').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await flush();
  expect((B.setCode as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('setcpm(120/4)\n$: s("bd*4")');
  expect((A.setCode as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  expect(root.querySelector('.lib-preview')).toBeNull();
});
