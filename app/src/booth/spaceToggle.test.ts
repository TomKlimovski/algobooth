import { isTransportKey, transportAction } from './spaceToggle';

const key = (code: string, target: EventTarget | null, repeat = false) => ({ code, target, repeat });

test('Space on the page body is the transport key; other keys and repeats are not', () => {
  expect(isTransportKey(key('Space', document.body))).toBe(true);
  expect(isTransportKey(key('Enter', document.body))).toBe(false);
  expect(isTransportKey(key('Space', document.body, true))).toBe(false);
});

test('Space inside an editor, input or button is left alone', () => {
  const editor = document.createElement('div');
  editor.className = 'cm-editor';
  const line = document.createElement('div');
  editor.appendChild(line);
  expect(isTransportKey(key('Space', line))).toBe(false);
  expect(isTransportKey(key('Space', document.createElement('input')))).toBe(false);
  expect(isTransportKey(key('Space', document.createElement('button')))).toBe(false);
});

test('transport action stops if anything plays, else starts', () => {
  expect(transportAction(true)).toBe('stop');
  expect(transportAction(false)).toBe('start');
});
