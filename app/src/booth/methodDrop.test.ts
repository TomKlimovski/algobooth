import { EditorView } from '@codemirror/view';
import { insertAtCursor, insertAtLineEnd, METHOD_MIME, methodDropExtension } from './methodDrop';
import { DEFAULT_CODE } from './Deck';

const drag = { name: 'lpf', snippet: '.lpf(800)', argRange: [5, 8] as [number, number] };
test('lands at the end of a plain line, selecting the argument', () => {
  expect(insertAtLineEnd('a: s("bd")\nb: s("hh")', 0, drag)).toEqual({ code: 'a: s("bd").lpf(800)\nb: s("hh")', selection: [15, 18] });
});
test('goes before a trailing comment and keeps a trailing semicolon', () => {
  expect(insertAtLineEnd('a: s("bd")  // kick', 0, drag)?.code).toBe('a: s("bd").lpf(800)  // kick');
  expect(insertAtLineEnd('a: s("bd");', 0, drag)?.code).toBe('a: s("bd").lpf(800);');
  expect(insertAtLineEnd('a: s("bd")   ', 0, drag)?.code).toBe('a: s("bd").lpf(800)   ');
});
test('a blank or comment line takes the nearest pattern line above', () => {
  expect(insertAtLineEnd('a: s("bd")\n\n// note\n', 2, drag)?.code).toBe('a: s("bd").lpf(800)\n\n// note\n');
});
test('a document with no pattern line refuses', () => {
  expect(insertAtLineEnd('// only\n\n', 1, drag)).toBeNull();
  expect(insertAtLineEnd('', 0, drag)).toBeNull();
});
test('a multi-line chain lands on the dropped-on line, not the last', () => {
  expect(insertAtLineEnd('a: s("bd")\n  .bank("tr909")\n  .gain(1)', 1, drag)?.code).toBe('a: s("bd")\n  .bank("tr909").lpf(800)\n  .gain(1)');
});
test('no argument means no selection', () => {
  expect(insertAtLineEnd('a: s("bd")', 0, { name: 'rev', snippet: '.rev()', argRange: null })).toEqual({ code: 'a: s("bd").rev()', selection: null });
});
test('a line index past the end uses the last line', () => {
  expect(insertAtLineEnd('a: s("bd")', 5, drag)?.code).toBe('a: s("bd").lpf(800)');
});
test('a // inside a string is not a comment', () => {
  expect(insertAtLineEnd('a: s("http://x")', 0, drag)?.code).toBe('a: s("http://x").lpf(800)');
});
test('a trailing comma behaves like a trailing semicolon', () => {
  const stack = 'stack(\n  s("bd*4"),\n  s("hh*8")\n).bank("tr909")';
  expect(insertAtLineEnd(stack, 1, drag)?.code).toBe('stack(\n  s("bd*4").lpf(800),\n  s("hh*8")\n).bank("tr909")');
});
test('a line ending in an opening bracket refuses rather than walking up', () => {
  expect(insertAtLineEnd('a: s("bd")\nstack(\n  s("hh")\n)', 1, drag)).toBeNull();
  expect(insertAtLineEnd('a: s("bd")\nx: cat([  // pats\n', 1, drag)).toBeNull();
});
test('a CRLF document lands before the carriage return', () => {
  expect(insertAtLineEnd('a: s("bd")\r\nb: s("hh")', 0, drag)?.code).toBe('a: s("bd").lpf(800)\r\nb: s("hh")');
});
test('a setup line is never a target: the walk goes down to the next pattern line', () => {
  expect(insertAtLineEnd('setcpm(30)\n\n$: s("bd")', 0, drag)?.code).toBe('setcpm(30)\n\n$: s("bd").lpf(800)');
  expect(insertAtLineEnd('setcpm(30)\n\n$: s("bd")', 1, drag)?.code).toBe('setcpm(30)\n\n$: s("bd").lpf(800)');
  expect(insertAtLineEnd('samples("x")\nconst k = 1\n$: s("bd")', 1, drag)?.code).toBe('samples("x")\nconst k = 1\n$: s("bd").lpf(800)');
  expect(insertAtLineEnd('setcpm(30)', 0, drag)).toBeNull();
});
test('a line ending inside a multi-line template literal refuses', () => {
  expect(insertAtLineEnd('note(`<c3 e3\ng3>`)', 0, drag)).toBeNull();
  expect(insertAtLineEnd('note(`<c3 e3\ng3>`)', 1, drag)?.code).toBe('note(`<c3 e3\ng3>`).lpf(800)');
});
test('a trailing comma after a number, an arrow or a binary operator refuses', () => {
  expect(insertAtLineEnd('$: s("bd").every(4,\n  x => x.fast(2))', 0, drag)).toBeNull();
  expect(insertAtLineEnd('$: s("bd").every(4, x =>\n  x.fast(2))', 0, drag)).toBeNull();
  expect(insertAtLineEnd('$: s("bd") +\n  s("hh")', 0, drag)).toBeNull();
  expect(insertAtLineEnd('stack(s("bd"),\n  s("hh"))', 0, drag)?.code).toBe('stack(s("bd").lpf(800),\n  s("hh"))');
});
test('a bare label line sends the drop down to its pattern body', () => {
  // `$:` alone, pattern on the next line: the method belongs on the body, not on a previous block
  expect(insertAtLineEnd('a: s("hh")\n$:\n  s("bd")', 1, drag)?.code).toBe('a: s("hh")\n$:\n  s("bd").lpf(800)');
  expect(insertAtLineEnd('bass:\n\n  note("c2")', 0, drag)?.code).toBe('bass:\n\n  note("c2").lpf(800)');
  // a blank line under the label walks up to the label, which still sends it down
  expect(insertAtLineEnd('$:\n\n  s("bd")', 1, drag)?.code).toBe('$:\n\n  s("bd").lpf(800)');
  // a label with nothing under it refuses
  expect(insertAtLineEnd('a: s("hh")\n$:', 1, drag)).toBeNull();
});
test('insertAtCursor on an untouched default deck lands on its pattern line', () => {
  const view = new EditorView({ doc: DEFAULT_CODE.A, parent: document.body });
  expect(view.state.selection.main.head).toBe(0);
  expect(insertAtCursor(view, drag)).toBe(true);
  expect(view.state.doc.toString()).toBe(`${DEFAULT_CODE.A}.lpf(800)`);
  expect(view.state.doc.line(2).text.endsWith('.lpf(800)')).toBe(true);
  view.destroy();
});

describe('methodDropExtension', () => {
  const mount = (doc: string, onRefused = vi.fn()) => {
    let view!: EditorView;
    view = new EditorView({ doc, extensions: methodDropExtension(() => view, onRefused), parent: document.body });
    // jsdom has no layout: every pointer lands on line 2.
    view.posAtCoords = () => view.state.doc.line(2).from;
    return { view, onRefused };
  };
  const dragEvent = (type: string, data: Record<string, string>) => {
    const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
    const dataTransfer = { types: Object.keys(data), getData: (t: string) => data[t] ?? '', dropEffect: 'none' };
    Object.defineProperty(e, 'dataTransfer', { value: dataTransfer });
    return e;
  };
  const payload = { [METHOD_MIME]: JSON.stringify(drag), 'text/plain': drag.snippet };

  test('a drop lands at the end of the line under the pointer, selecting the argument', () => {
    const { view, onRefused } = mount('setcpm(30)\n$: s("bd")');
    const e = dragEvent('drop', payload);
    view.contentDOM.dispatchEvent(e);
    expect(view.state.doc.toString()).toBe('setcpm(30)\n$: s("bd").lpf(800)');
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe('800');
    expect(e.defaultPrevented).toBe(true);
    expect(onRefused).not.toHaveBeenCalled();
    view.destroy();
  });
  test('a refused drop still never lets the text copy in', () => {
    const { view, onRefused } = mount('// only\n// comments');
    const e = dragEvent('drop', payload);
    view.contentDOM.dispatchEvent(e);
    expect(view.state.doc.toString()).toBe('// only\n// comments');
    expect(e.defaultPrevented).toBe(true);
    expect(onRefused).toHaveBeenCalledOnce();
    view.destroy();
  });
  test('dragover allows a method drag and leaves other drags alone', () => {
    const { view } = mount('a: s("bd")\nb: s("hh")');
    const over = dragEvent('dragover', payload);
    view.contentDOM.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    const text = dragEvent('drop', { 'text/plain': 'x' });
    view.contentDOM.dispatchEvent(text);
    expect(view.state.doc.toString()).not.toContain('.lpf');
    view.destroy();
  });
});
