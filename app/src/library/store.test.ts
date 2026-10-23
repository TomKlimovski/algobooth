import { createDeckState, type DeckId } from '../booth/deckState';
import type { DeckApi } from '../booth/Deck';
import type { LibraryApi, Pattern, TreeNode } from './api';
import { createLibraryStore } from './store';

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
    list_tree: vi.fn(async () => api.tree),
    read_pattern: vi.fn(async (_path: string) => pattern()),
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

function fakeDeck(id: DeckId, opts: { dirty?: boolean; saves?: boolean; started?: boolean } = {}) {
  const state = createDeckState(id);
  const setCode = vi.fn();
  const setFile = vi.fn();
  const save = vi.fn(async () => opts.saves ?? true);
  const cue = vi.fn();
  const api = {
    id,
    setCode,
    setName: state.setName,
    setFile,
    filePath: () => state.state.filePath,
    moveFile: state.setFilePath,
    isDirty: () => opts.dirty ?? false,
    save,
    cue,
    scheduler: { started: opts.started ?? false },
  } as unknown as DeckApi;
  return { state, api, setCode, setFile, save, cue };
}

test('refresh loads the tree and keeps fold state for surviving paths', async () => {
  const api = fakeApi(heading('', [heading('mine', [leaf('mine/a.json')]), heading('ripped')]));
  const lib = createLibraryStore(api, () => ({ A: null, B: null }));
  await lib.refresh();
  expect(api.list_tree).toHaveBeenCalledWith();
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

test('load sets deck code and name', async () => {
  const api = fakeApi(heading('', [heading('mine', [leaf('mine/x.json')])]));
  const b = fakeDeck('B');
  const lib = createLibraryStore(api, () => ({ A: null, B: b.api }));
  await lib.refresh();
  await lib.load('mine/x.json', 'B');
  expect(api.read_pattern).toHaveBeenCalledWith('mine/x.json');
  expect(b.setCode).toHaveBeenCalledWith('y');
  expect(b.state.state.name).toBe('x');
  expect(b.setFile).toHaveBeenCalledWith('mine/x.json', 'y', expect.objectContaining({ code: 'y' }));
});

test('unreadable leaves are shown but cannot be loaded', async () => {
  const api = fakeApi(heading('', [leaf('broken.json', 'unreadable')]));
  const a = fakeDeck('A');
  const lib = createLibraryStore(api, () => ({ A: a.api, B: null }));
  await lib.refresh();
  expect(lib.state.root?.children[0].kind).toBe('unreadable');
  await expect(lib.load('broken.json', 'A')).rejects.toThrow('This file is not a valid pattern');
  expect(api.read_pattern).not.toHaveBeenCalled();
  expect(a.setCode).not.toHaveBeenCalled();
});

test('cue reads the pattern, hands it to the deck, and makes the deck the target', async () => {
  const api = fakeApi(heading('', [leaf('x.json')]));
  const b = fakeDeck('B');
  const lib = createLibraryStore(api, () => ({ A: fakeDeck('A').api, B: b.api }));
  await lib.refresh();
  await expect(lib.cue('x.json', 'B')).resolves.toBe(true);
  expect(b.cue).toHaveBeenCalledWith('x.json', pattern());
  expect(b.setCode).not.toHaveBeenCalled();
  expect(lib.state.target).toBe('B');
});

test('cue refuses a heading or an unreadable file like a load', async () => {
  const api = fakeApi(heading('', [heading('h'), leaf('bad.json', 'unreadable')]));
  const lib = createLibraryStore(api, () => ({ A: fakeDeck('A').api, B: null }));
  await lib.refresh();
  await expect(lib.cue('h', 'A')).rejects.toThrow('Only patterns');
  await expect(lib.cue('bad.json', 'A')).rejects.toThrow('not a valid pattern');
});

test('a double-click cues onto a playing target and loads onto a stopped one; shift does the other', async () => {
  const api = fakeApi(heading('', [leaf('x.json')]));
  const a = fakeDeck('A', { started: true });
  const b = fakeDeck('B');
  const lib = createLibraryStore(api, () => ({ A: a.api, B: b.api }));
  await lib.refresh();
  await lib.doubleClick('x.json', false);
  expect(a.cue).toHaveBeenCalledTimes(1);
  expect(a.setCode).not.toHaveBeenCalled();
  await lib.doubleClick('x.json', true);
  expect(a.setCode).toHaveBeenCalledWith('y');
  lib.setTarget('B');
  await lib.doubleClick('x.json', false);
  expect(b.setCode).toHaveBeenCalledWith('y');
  expect(b.cue).not.toHaveBeenCalled();
  await lib.doubleClick('x.json', true);
  expect(b.cue).toHaveBeenCalledTimes(1);
});

test('rename and move keep the entry selected and its folds, then refresh', async () => {
  const api = fakeApi(heading('', [heading('mine', [heading('mine/bass')]), heading('sets')]));
  const lib = createLibraryStore(api, () => ({ A: null, B: null }));
  await lib.refresh();
  lib.toggleFold('mine/bass');
  lib.select('mine/bass');

  api.move_entry.mockResolvedValueOnce('sets/bass');
  api.tree = heading('', [heading('mine'), heading('sets', [heading('sets/bass')])]);
  await expect(lib.move('mine/bass', 'sets')).resolves.toBe('sets/bass');
  expect(api.move_entry).toHaveBeenCalledWith('mine/bass', 'sets');
  expect(lib.state.selected).toBe('sets/bass');
  expect([...lib.state.folded]).toEqual(['sets/bass']);
  expect(api.list_tree).toHaveBeenCalledTimes(2);

  api.rename_entry.mockResolvedValueOnce('sets/low end');
  api.tree = heading('', [heading('mine'), heading('sets', [heading('sets/low end')])]);
  await lib.rename('sets/bass', 'low end');
  expect(api.rename_entry).toHaveBeenCalledWith('sets/bass', 'low end');
  expect(lib.state.selected).toBe('sets/low end');
  expect([...lib.state.folded]).toEqual(['sets/low end']);
});

test('a failed action rejects and records its error until the next success', async () => {
  const api = fakeApi(heading('', [heading('mine')]));
  const lib = createLibraryStore(api, () => ({ A: null, B: null }));
  api.create_heading.mockRejectedValueOnce('mine already exists');
  await expect(lib.createHeading('', 'mine')).rejects.toThrow('mine already exists');
  expect(lib.state.error).toBe('mine already exists');
  await lib.refresh();
  expect(lib.state.error).toBeNull();
});

test('new pattern writes the untitled starter and duplicate copies next to the original', async () => {
  const api = fakeApi(heading('', [heading('mine', [leaf('mine/x.json')])]));
  const lib = createLibraryStore(api, () => ({ A: null, B: null }));
  await lib.newPattern('mine');
  expect(api.write_pattern).toHaveBeenCalledWith('mine', {
    name: 'untitled',
    code: 'setcpm(120/4)',
    cpm: 120,
    key: '',
    tags: [],
    source: { kind: 'mine' },
    notes: '',
  });
  await lib.duplicate('mine/x.json');
  expect(api.write_pattern).toHaveBeenLastCalledWith('mine', pattern({ name: 'x copy' }));
});

test('remove sends the entry to the trash and drops a stale selection', async () => {
  const api = fakeApi(heading('', [leaf('a.json')]));
  const lib = createLibraryStore(api, () => ({ A: null, B: null }));
  await lib.refresh();
  lib.select('a.json');
  api.tree = heading('');
  await lib.remove('a.json');
  expect(api.delete_entry).toHaveBeenCalledWith('a.json');
  expect(lib.state.selected).toBeNull();
});

test('a double-click loads into the target deck: A at first, then the deck last used or loaded', async () => {
  const api = fakeApi(heading('', [leaf('x.json'), leaf('y.json')]));
  const a = fakeDeck('A');
  const b = fakeDeck('B');
  const lib = createLibraryStore(api, () => ({ A: a.api, B: b.api }));
  await lib.refresh();
  expect(lib.state.target).toBe('A');
  await expect(lib.loadToTarget('x.json')).resolves.toBe(true);
  expect(a.setCode).toHaveBeenCalledWith('y');
  lib.setTarget('B');
  await lib.loadToTarget('y.json');
  expect(b.setCode).toHaveBeenCalledWith('y');
  // Loading onto a deck any other way (a drop, Load to A) makes that deck the target too.
  await lib.load('x.json', 'A');
  expect(lib.state.target).toBe('A');
});

test('preview reads a pattern once until the next refresh', async () => {
  const api = fakeApi(heading('', [leaf('x.json')]));
  const lib = createLibraryStore(api, () => ({ A: null, B: null }));
  await lib.refresh();
  await expect(lib.preview('x.json')).resolves.toBe('y');
  await expect(lib.preview('x.json')).resolves.toBe('y');
  expect(api.read_pattern).toHaveBeenCalledTimes(1);
  await lib.refresh();
  await lib.preview('x.json');
  expect(api.read_pattern).toHaveBeenCalledTimes(2);
  api.read_pattern.mockRejectedValueOnce(new Error('gone'));
  await expect(lib.preview('x.json')).resolves.toBe('y'); // still cached
});

test('a watch warning survives a successful refresh', async () => {
  const api = fakeApi(heading('', [heading('mine')]));
  const lib = createLibraryStore(api, () => ({ A: null, B: null }));
  lib.setWatchWarning('Live refresh is off: no backend');
  await lib.refresh();
  expect(lib.state.error).toBeNull();
  expect(lib.state.watchWarning).toBe('Live refresh is off: no backend');
  lib.setWatchWarning(null);
  expect(lib.state.watchWarning).toBeNull();
});

test('drops are refused during drag for headings on decks and headings into their own subtree', async () => {
  const api = fakeApi(heading('', [heading('mine', [heading('mine/bass', [leaf('mine/bass/x.json')])]), heading('sets')]));
  const lib = createLibraryStore(api, () => ({ A: null, B: null }));
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
  const lib = createLibraryStore(api, () => ({ A: null, B: null }));
  await lib.savePattern('mine/x.json', pattern({ code: 'z' }));
  expect(api.save_pattern).toHaveBeenCalledWith('mine/x.json', pattern({ code: 'z' }));
  expect(api.list_tree).not.toHaveBeenCalled();
  expect(await lib.writePattern('mine', pattern())).toBe('mine/untitled.json');
  expect(api.write_pattern).toHaveBeenCalledWith('mine', pattern());
  expect(api.list_tree).toHaveBeenCalledTimes(1);
});

test('renaming or moving a deck\'s open file keeps the deck on it', async () => {
  const api = fakeApi(heading('', [heading('mine', [leaf('mine/x.json')]), heading('live')]));
  const a = fakeDeck('A');
  const b = fakeDeck('B');
  a.state.setFile('mine/x.json', 'y');
  b.state.setFile('live/other.json', 'z');
  const lib = createLibraryStore(api, () => ({ A: a.api, B: b.api }));
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

test('loading onto a deck with unsaved edits asks first: Cancel keeps editing, OK saves then loads', async () => {
  const api = fakeApi(heading('', [leaf('x.json')]));
  const confirm = vi.fn(() => false);
  const a = fakeDeck('A', { dirty: true });
  const lib = createLibraryStore(api, () => ({ A: a.api, B: null }), confirm);
  await lib.refresh();

  await expect(lib.load('x.json', 'A')).resolves.toBe(false);
  expect(confirm).toHaveBeenCalledWith('Save changes before loading another pattern? OK saves first, Cancel keeps editing.');
  expect(a.save).not.toHaveBeenCalled();
  expect(api.read_pattern).not.toHaveBeenCalled();
  expect(a.setCode).not.toHaveBeenCalled();

  confirm.mockReturnValue(true);
  await expect(lib.load('x.json', 'A')).resolves.toBe(true);
  expect(a.save).toHaveBeenCalledTimes(1);
  expect(a.save.mock.invocationCallOrder[0]).toBeLessThan(api.read_pattern.mock.invocationCallOrder[0]);
  expect(a.setCode).toHaveBeenCalledWith('y');
});

test('a failed or cancelled save keeps the edits and loads nothing', async () => {
  const api = fakeApi(heading('', [leaf('x.json')]));
  const a = fakeDeck('A', { dirty: true, saves: false });
  const lib = createLibraryStore(api, () => ({ A: a.api, B: null }), () => true);
  await lib.refresh();
  await expect(lib.load('x.json', 'A')).resolves.toBe(false);
  expect(a.save).toHaveBeenCalled();
  expect(a.setCode).not.toHaveBeenCalled();
});

test('a clean deck loads without asking', async () => {
  const api = fakeApi(heading('', [leaf('x.json')]));
  const confirm = vi.fn(() => false);
  const a = fakeDeck('A');
  const lib = createLibraryStore(api, () => ({ A: a.api, B: null }), confirm);
  await lib.refresh();
  await expect(lib.load('x.json', 'A')).resolves.toBe(true);
  expect(confirm).not.toHaveBeenCalled();
  expect(a.setCode).toHaveBeenCalledWith('y');
});
