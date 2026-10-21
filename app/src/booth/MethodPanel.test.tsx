import { render } from 'solid-js/web';
import { PREVIEW_DELAY_MS } from '../library/LibraryTree';
import { catalogue, FUNCTION_GROUPS, GROUPS } from '../methods/catalogue';
import { METHOD_MIME, type MethodDrag } from './methodDrop';
import { MethodPanel } from './MethodPanel';

let dispose = () => {};
let root: HTMLDivElement;
const section = (kind: 'method' | 'function') => root.querySelector<HTMLElement>(`.methods-section[data-kind="${kind}"]`)!;
const foldersIn = (kind: 'method' | 'function') => [...(section(kind)?.querySelectorAll<HTMLElement>('.method-folder') ?? [])];
const folders = () => foldersIn('method');
const folderIn = (kind: 'method' | 'function', group: string) =>
  foldersIn(kind).find((f) => f.querySelector('.method-folder-name')?.textContent === group)!;
const folder = (group: string) => folderIn('method', group);
const rows = () => [...root.querySelectorAll<HTMLElement>('.method-row')];
const row = (name: string) => root.querySelector<HTMLElement>(`.method-row[data-name="${name}"]`);
const duck = catalogue.methods.find((m) => m.name === 'duckattack')!;

function mount(onInsert?: (drag: MethodDrag) => void) {
  root = document.createElement('div');
  document.body.append(root);
  dispose = render(() => <MethodPanel onInsert={onInsert} />, root);
}
function search(text: string) {
  const input = root.querySelector<HTMLInputElement>('.method-search')!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function openDucking() {
  folder('Ducking').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return row('duckattack')!;
}
afterEach(() => {
  dispose();
  root.remove();
  vi.useRealTimers();
});

test('renders the groups in order, collapsed, and expands one on click', () => {
  mount();
  const populated = GROUPS.filter((g) => catalogue.methods.some((m) => m.group === g));
  expect(folders().map((f) => f.querySelector('.method-folder-name')?.textContent)).toEqual(populated);
  expect(folders().every((f) => f.getAttribute('aria-expanded') === 'false')).toBe(true);
  expect(rows()).toHaveLength(0);
  const ducking = catalogue.methods.filter((m) => m.group === 'Ducking').map((m) => m.name);
  openDucking();
  expect(folder('Ducking').getAttribute('aria-expanded')).toBe('true');
  expect(rows().map((r) => r.dataset.name)).toEqual(ducking);
  folder('Ducking').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(rows()).toHaveLength(0);
});

test('search filters rows by name, synonym and description, expanding matching folders and hiding empty ones', () => {
  mount();
  search('duckatt'); // a synonym of duckattack, and a prefix of its name
  expect(folders()).toHaveLength(1);
  expect(folder('Ducking').getAttribute('aria-expanded')).toBe('true');
  expect(rows().map((r) => r.dataset.name)).toEqual(['duckattack']);
  search('RETURN TO THEIR NORMAL'); // only in duckattack's description, and case-insensitive
  expect(rows().map((r) => r.dataset.name)).toContain('duckattack');
  search('zzzz');
  expect(folders()).toHaveLength(0);
  search('');
  expect(rows()).toHaveLength(0);
});

test('dragstart carries both MIME types', () => {
  mount();
  const data: Record<string, string> = {};
  const event = new Event('dragstart', { bubbles: true });
  Object.defineProperty(event, 'dataTransfer', { value: { setData: (type: string, v: string) => (data[type] = v), effectAllowed: 'none' } });
  openDucking().dispatchEvent(event);
  expect(data['text/plain']).toBe(duck.snippet);
  expect(JSON.parse(data[METHOD_MIME])).toEqual({ name: 'duckattack', snippet: duck.snippet, argRange: duck.argRange, kind: 'method' });
});

test('resting the pointer shows the description, synonyms and note; leaving hides it', async () => {
  mount();
  const r = openDucking();
  vi.useFakeTimers();
  r.dispatchEvent(new MouseEvent('mouseenter'));
  expect(root.querySelector('.method-tip')).toBeNull();
  await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS + 1);
  const tip = root.querySelector('.method-tip')!.textContent!;
  expect(tip).toContain(duck.snippet);
  expect(tip).toContain(duck.description);
  expect(tip).toContain('also: duckatt');
  expect(tip).toContain('time: number | Pattern');
  expect(tip).toContain(duck.note!);
  r.dispatchEvent(new MouseEvent('mouseleave'));
  expect(root.querySelector('.method-tip')).toBeNull();
  // Keyboard focus shows it too.
  r.dispatchEvent(new FocusEvent('focus'));
  await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS + 1);
  expect(root.querySelector('.method-tip')).not.toBeNull();
  r.dispatchEvent(new FocusEvent('blur'));
  expect(root.querySelector('.method-tip')).toBeNull();
});

test('double-click calls onInsert with the row', () => {
  const onInsert = vi.fn();
  mount(onInsert);
  openDucking().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  expect(onInsert).toHaveBeenCalledWith({ name: 'duckattack', snippet: duck.snippet, argRange: duck.argRange, kind: 'method' });
});

test('a Functions section follows the methods, with its own folders', () => {
  mount();
  expect([...root.querySelectorAll('.methods-section-title')].map((h) => h.textContent)).toEqual(['Methods', 'Functions']);
  const populated = FUNCTION_GROUPS.filter((g) => catalogue.methods.some((m) => m.kind === 'function' && m.group === g));
  expect(foldersIn('function').map((f) => f.querySelector('.method-folder-name')?.textContent)).toEqual(populated);
  folderIn('function', 'Combine').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const seq = section('function').querySelector<HTMLElement>('.method-row[data-name="seq"]')!;
  expect(seq).not.toBeNull();
  const data: Record<string, string> = {};
  const event = new Event('dragstart', { bubbles: true });
  Object.defineProperty(event, 'dataTransfer', { value: { setData: (type: string, v: string) => (data[type] = v), effectAllowed: 'none' } });
  seq.dispatchEvent(event);
  expect(JSON.parse(data[METHOD_MIME])).toMatchObject({ name: 'seq', kind: 'function' });
  expect(data['text/plain']).toBe('seq("bd*4", "hh*8")');
});

test('search spans both sections and hides a section with no match', () => {
  mount();
  search('seq'); // the function seq, and the methods whose descriptions mention a sequence
  expect(foldersIn('function').map((f) => f.querySelector('.method-folder-name')?.textContent)).toContain('Combine');
  expect(section('function').querySelector('.method-row[data-name="seq"]')).not.toBeNull();
  search('duckatt'); // methods only
  expect(root.querySelector('.methods-section[data-kind="function"]')).toBeNull();
  expect(folders()).toHaveLength(1);
});
