import { createDeckState, type DeckId } from '../booth/deckState';
import type { DeckApi } from '../booth/Deck';
import type { LibraryApi, Pattern, TreeNode } from './api';
import { createLibraryStore, pickDeckForDoubleClick } from './store';

const heading = (path: string, children: TreeNode[] = []): TreeNode => ({
  name: path.split('/').pop() || 'library',
  path,
  kind: 'heading',
  cpm: null,
  children,
});
const leaf = (path: string, kind: 'pattern' | 'unreadable' = 'pattern'): TreeNode => ({
  name: path.split('/').pop()!.replace(/\.json$/, ''),
  path,
  kind,
  cpm: kind === 'pattern' ? 120 : null,
  children: [],
});
const pattern = (over: Partial<Pattern> = {}): Pattern => ({
  name: 'x',
  code: 'y',
  cpm: 120,
  key: '',
  tags: [],
  source: { kind: 'mine' },
  notes: '',
  ...over,
});

function fakeApi(tree: TreeNode) {
  const api = {
    tree,
    list_tree: vi.fn(async (_root: string) => api.tree),
    read_pattern: vi.fn(async (_root: string, _path: string) => pattern()),
    write_pattern: vi.fn(async () => 'mine/untitled.json'),
    save_pattern: vi.fn(async () => {}),
    create_heading: vi.fn(async () => 'mine/new'),
    rename_entry: vi.fn(async () => 'mine/renamed.json'),
    move_entry: vi.fn(async () => 'moved.json'),
    delete_entry: vi.fn(async () => {}),
    ensure_library: vi.fn(async () => {}),
    watch_library: vi.fn(async () => {}),
    onLibraryChanged: vi.fn(async () => () => {}),
  };
  return api satisfies LibraryApi;
}

function fakeDeck(id: DeckId) {
  const state = createDeckState(id);
  const setCode = vi.fn();
  const setFile = vi.fn();
  const api = {
    id,
    setCode,
    setName: state.setName,
    setFile,
    filePath: () => state.state.filePath,
    moveFile: state.setFilePath,
    scheduler: { started: false },
  } as unknown as DeckApi;
  return { state, api, setCode, setFile };
}

test('refresh loads the tree and keeps fold state for surviving paths', async () => {
  const api = fakeApi(heading('', [heading('mine', [leaf('mine/a.json')]), heading('ripped')]));
  const lib = createLibraryStore(api, () => ({ A: null, B: null }), () => '/lib');
  await lib.refresh();
  expect(api.list_tree).toHaveBeenCalledWith('/lib');
  expect(lib.state.root?.children.map((c) => c.path)).toEqual(['mine', 'ripped']);

  lib.toggleFold('mine');
  lib.toggleFold('ripped');
  expect([...lib.state.folded].sort()).toEqual(['mine', 'ripped']);

  api.tree = heading('', [heading('mine', [leaf('mine/a.json'), leaf('mine/b.json')])]);
  await lib.refresh();
  expect(lib.state.root?.children[0].children).toHaveLength(2);
  expect([...lib.state.folded]).toEqual(['mine']);

  lib.toggleFold('mine');
  expect(lib.state.folded.size).toBe(0);
});

test('double-click loads into the deck that is not playing', () => {
  expect(pickDeckForDoubleClick({ A: { started: true }, B: { started: false } })).toBe('B');
  expect(pickDeckForDoubleClick({ A: { started: false }, B: { started: true } })).toBe('A');
  expect(pickDeckForDoubleClick({ A: { started: true }, B: { started: true } })).toBe('B');
  expect(pickDeckForDoubleClick({ A: { started: false }, B: { started: false } })).toBe('B');
});

test('load sets deck code and name', async () => {
  const api = fakeApi(heading('', [heading('mine', [leaf('mine/x.json')])]));
  const b = fakeDeck('B');
  const lib = createLibraryStore(api, () => ({ A: null, B: b.api }), () => '/lib');
  await lib.refresh();
  await lib.load('mine/x.json', 'B');
  expect(api.read_pattern).toHaveBeenCalledWith('/lib', 'mine/x.json');
  expect(b.setCode).toHaveBeenCalledWith('y');
  expect(b.state.state.name).toBe('x');
  expect(b.setFile).toHaveBeenCalledWith('mine/x.json', 'y', expect.objectContaining({ code: 'y' }));
});

test('unreadable leaves are shown but cannot be loaded', async () => {
  const api = fakeApi(heading('', [leaf('broken.json', 'unreadable')]));
  const a = fakeDeck('A');
  const lib = createLibraryStore(api, () => ({ A: a.api, B: null }), () => '/lib');
  await lib.refresh();
  expect(lib.state.root?.children[0].kind).toBe('unreadable');
  await expect(lib.load('broken.json', 'A')).rejects.toThrow('This file is not a valid pattern');
  expect(api.read_pattern).not.toHaveBeenCalled();
  expect(a.setCode).not.toHaveBeenCalled();
});

test('rename and move keep the entry selected and its folds, then refresh', async () => {
  const api = fakeApi(heading('', [heading('mine', [heading('mine/bass')]), heading('sets')]));
  const lib = createLibraryStore(api, () => ({ A: null, B: null }), () => '/lib');
  await lib.refresh();
  lib.toggleFold('mine/bass');
  lib.select('mine/bass');

  api.move_entry.mockResolvedValueOnce('sets/bass');
  api.tree = heading('', [heading('mine'), heading('sets', [heading('sets/bass')])]);
  await expect(lib.move('mine/bass', 'sets')).resolves.toBe('sets/bass');
  expect(api.move_entry).toHaveBeenCalledWith('/lib', 'mine/bass', 'sets');
  expect(lib.state.selected).toBe('sets/bass');
  expect([...lib.state.folded]).toEqual(['sets/bass']);
  expect(api.list_tree).toHaveBeenCalledTimes(2);

  api.rename_entry.mockResolvedValueOnce('sets/low end');
  api.tree = heading('', [heading('mine'), heading('sets', [heading('sets/low end')])]);
  await lib.rename('sets/bass', 'low end');
  expect(api.rename_entry).toHaveBeenCalledWith('/lib', 'sets/bass', 'low end');
  expect(lib.state.selected).toBe('sets/low end');
  expect([...lib.state.folded]).toEqual(['sets/low end']);
});

test('a failed action rejects and records its error until the next success', async () => {
  const api = fakeApi(heading('', [heading('mine')]));
  const lib = createLibraryStore(api, () => ({ A: null, B: null }), () => '/lib');
  api.create_heading.mockRejectedValueOnce('mine already exists');
  await expect(lib.createHeading('', 'mine')).rejects.toThrow('mine already exists');
  expect(lib.state.error).toBe('mine already exists');
  await lib.refresh();
  expect(lib.state.error).toBeNull();
});

test('new pattern writes the untitled starter and duplicate copies next to the original', async () => {
  const api = fakeApi(heading('', [heading('mine', [leaf('mine/x.json')])]));
  const lib = createLibraryStore(api, () => ({ A: null, B: null }), () => '/lib');
  await lib.newPattern('mine');
  expect(api.write_pattern).toHaveBeenCalledWith('/lib', 'mine', {
    name: 'untitled',
    code: 'setcpm(120/4)',
    cpm: 120,
    key: '',
    tags: [],
    source: { kind: 'mine' },
    notes: '',
  });
  await lib.duplicate('mine/x.json');
  expect(api.write_pattern).toHaveBeenLastCalledWith('/lib', 'mine', pattern({ name: 'x copy' }));
});

test('remove sends the entry to the trash and drops a stale selection', async () => {
  const api = fakeApi(heading('', [leaf('a.json')]));
  const lib = createLibraryStore(api, () => ({ A: null, B: null }), () => '/lib');
  await lib.refresh();
  lib.select('a.json');
  api.tree = heading('');
  await lib.remove('a.json');
  expect(api.delete_entry).toHaveBeenCalledWith('/lib', 'a.json');
  expect(lib.state.selected).toBeNull();
});

test('loadToIdleDeck loads into the deck that is not playing', async () => {
  const api = fakeApi(heading('', [leaf('x.json')]));
  const a = fakeDeck('A');
  const b = fakeDeck('B');
  (b.api.scheduler as { started: boolean }).started = true;
  const lib = createLibraryStore(api, () => ({ A: a.api, B: b.api }), () => '/lib');
  await lib.refresh();
  await expect(lib.loadToIdleDeck('x.json')).resolves.toBe('A');
  expect(a.setCode).toHaveBeenCalledWith('y');
  expect(b.setCode).not.toHaveBeenCalled();
});

test('a watch warning survives a successful refresh', async () => {
  const api = fakeApi(heading('', [heading('mine')]));
  const lib = createLibraryStore(api, () => ({ A: null, B: null }), () => '/lib');
  lib.setWatchWarning('Live refresh is off: no backend');
  await lib.refresh();
  expect(lib.state.error).toBeNull();
  expect(lib.state.watchWarning).toBe('Live refresh is off: no backend');
  lib.setWatchWarning(null);
  expect(lib.state.watchWarning).toBeNull();
});

test('drops are refused during drag for headings on decks and headings into their own subtree', async () => {
  const api = fakeApi(heading('', [heading('mine', [heading('mine/bass', [leaf('mine/bass/x.json')])]), heading('sets')]));
  const lib = createLibraryStore(api, () => ({ A: null, B: null }), () => '/lib');
  await lib.refresh();
  expect(lib.canDrop({ deck: true })).toBe(false); // nothing dragged

  lib.setDragging('mine');
  expect(lib.canDrop({ deck: true })).toBe(false);
  expect(lib.canDrop({ heading: 'mine' })).toBe(false);
  expect(lib.canDrop({ heading: 'mine/bass' })).toBe(false);
  expect(lib.canDrop({ heading: '' })).toBe(false); // already at the root
  expect(lib.canDrop({ heading: 'sets' })).toBe(true);

  lib.setDragging('mine/bass/x.json');
  expect(lib.canDrop({ deck: true })).toBe(true);
  expect(lib.canDrop({ heading: 'mine/bass' })).toBe(false);
  expect(lib.canDrop({ heading: 'mine' })).toBe(true);
  expect(lib.canDrop({ heading: 'sets' })).toBe(true);
});

test('deck saves go to the library root: save overwrites in place, save as writes and refreshes', async () => {
  const api = fakeApi(heading('', [heading('mine')]));
  const lib = createLibraryStore(api, () => ({ A: null, B: null }), () => '/lib');
  await lib.savePattern('mine/x.json', pattern({ code: 'z' }));
  expect(api.save_pattern).toHaveBeenCalledWith('/lib', 'mine/x.json', pattern({ code: 'z' }));
  expect(api.list_tree).not.toHaveBeenCalled();
  expect(await lib.writePattern('mine', pattern())).toBe('mine/untitled.json');
  expect(api.write_pattern).toHaveBeenCalledWith('/lib', 'mine', pattern());
  expect(api.list_tree).toHaveBeenCalledTimes(1);
});

test('renaming or moving a deck\'s open file keeps the deck on it', async () => {
  const api = fakeApi(heading('', [heading('mine', [leaf('mine/x.json')]), heading('live')]));
  const a = fakeDeck('A');
  const b = fakeDeck('B');
  a.state.setFile('mine/x.json', 'y');
  b.state.setFile('live/other.json', 'z');
  const lib = createLibraryStore(api, () => ({ A: a.api, B: b.api }), () => '/lib');
  await lib.refresh();

  api.rename_entry.mockResolvedValueOnce('mine/renamed.json');
  await lib.rename('mine/x.json', 'renamed');
  expect(a.state.state).toMatchObject({ filePath: 'mine/renamed.json', savedCode: 'y', name: 'renamed' });
  expect(b.state.state).toMatchObject({ filePath: 'live/other.json', name: 'untitled' });

  api.move_entry.mockResolvedValueOnce('live/mine');
  await lib.move('mine', 'live');
  expect(a.state.state.filePath).toBe('live/mine/renamed.json');
  expect(b.state.state.filePath).toBe('live/other.json');
});
