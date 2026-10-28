import { globalKey, transportAction, transportKey } from './transportKeys';

type Mods = { repeat?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean };
const key = (code: string, target: EventTarget | null, mods: Mods = {}) => ({ code, target, ...mods });
const editorLine = () => {
  const editor = document.createElement('div');
  editor.className = 'cm-editor';
  const line = document.createElement('div');
  editor.appendChild(line);
  return line;
};

test('Space on the page body toggles both decks; other keys and repeats do not', () => {
  expect(transportKey(key('Space', document.body))).toBe('both');
  expect(transportKey(key('Enter', document.body))).toBe(null);
  expect(transportKey(key('Space', document.body, { repeat: true }))).toBe(null);
});

test('Space inside an editor, input or button is left alone', () => {
  expect(transportKey(key('Space', editorLine()))).toBe(null);
  expect(transportKey(key('Space', document.createElement('input')))).toBe(null);
  expect(transportKey(key('Space', document.createElement('button')))).toBe(null);
});

test('Cmd+Enter on the Mac and Ctrl+Enter elsewhere toggle the deck, in the editor too', () => {
  expect(transportKey(key('Enter', document.body, { metaKey: true }), true, true)).toBe('deck');
  expect(transportKey(key('Enter', editorLine(), { metaKey: true }), true, true)).toBe('deck');
  expect(transportKey(key('NumpadEnter', document.body, { metaKey: true }), true, true)).toBe('deck');
  // Ctrl+Enter on the Mac stays the editor's evaluate.
  expect(transportKey(key('Enter', editorLine(), { ctrlKey: true }), true, true)).toBe(null);
  expect(transportKey(key('Enter', document.body, { ctrlKey: true }), true, false)).toBe('deck');
  expect(transportKey(key('Enter', document.body, { metaKey: true }), true, false)).toBe(null);
  expect(transportKey(key('Enter', document.body, { metaKey: true, shiftKey: true }), true, true)).toBe(null);
  expect(transportKey(key('Enter', document.createElement('input'), { metaKey: true }), true, true)).toBe(null);
  expect(transportKey(key('Enter', document.body, { metaKey: true, repeat: true }), true, true)).toBe(null);
});

test('Backquote stops everything, even from a focused button, but not while typing', () => {
  expect(transportKey(key('Backquote', document.body))).toBe('stopAll');
  expect(transportKey(key('Backquote', document.createElement('button')))).toBe('stopAll');
  expect(transportKey(key('Backquote', editorLine()))).toBe(null);
  expect(transportKey(key('Backquote', document.createElement('input')))).toBe(null);
  expect(transportKey(key('Backquote', document.body, { shiftKey: true }))).toBe(null);
});

test('no transport key works while another tab is showing', () => {
  expect(transportKey(key('Space', document.body), false)).toBe(null);
  expect(transportKey(key('Backquote', document.body), false)).toBe(null);
  expect(transportKey(key('Enter', document.body, { metaKey: true }), false, true)).toBe(null);
});

test('transport action stops if anything plays, else starts', () => {
  expect(transportAction(true)).toBe('stop');
  expect(transportAction(false)).toBe('start');
});

test('Alt+Z plays or stops and Alt+X updates, on any tab and with any focus', () => {
  const field = document.createElement('input');
  for (const target of [document.body, editorLine(), field, document.createElement('button')]) {
    expect(globalKey(key('KeyZ', target, { altKey: true }))).toBe('toggle');
    expect(globalKey(key('KeyX', target, { altKey: true }))).toBe('update');
  }
});

test('the global keys need Alt alone; plain, other modifiers and other letters are not theirs', () => {
  expect(globalKey(key('KeyZ', document.body))).toBe(null);
  expect(globalKey(key('KeyX', document.body, { shiftKey: true }))).toBe(null);
  expect(globalKey(key('KeyZ', document.body, { ctrlKey: true }))).toBe(null);
  expect(globalKey(key('KeyZ', document.body, { metaKey: true }))).toBe(null);
  expect(globalKey(key('KeyZ', document.body, { altKey: true, shiftKey: true }))).toBe(null);
  expect(globalKey(key('KeyC', document.body, { altKey: true }))).toBe(null);
});

test('a held global key repeats as swallowed, not as another press', () => {
  expect(globalKey(key('KeyZ', document.body, { altKey: true, repeat: true }))).toBe('repeat');
  expect(globalKey(key('KeyX', editorLine(), { altKey: true, repeat: true }))).toBe('repeat');
});
