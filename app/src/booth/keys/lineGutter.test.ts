import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { lineGutterExtension, numberAt, patternLineDecoration, refreshLines } from './lineGutter';
import { patternLines, type PatternLine } from './lines';

const CODE = ['setcpm(124/4)', 'drums: s("bd*4")', '_fills: s("cp")', '  .gain(0.5)', '$: note("c2")'].join('\n');

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
  document.body.innerHTML = '';
});

/** A real editor in jsdom with the gutter and the target decoration, fed from plain variables. */
function mount(code: string, target: number | null) {
  const state = { lines: patternLines(code) as PatternLine[], target };
  view = new EditorView({
    doc: code,
    parent: document.body,
    extensions: [
      lineGutterExtension(() => state.lines, () => state.target),
      patternLineDecoration(() => state.lines, () => state.target),
    ],
  });
  return state;
}

// The gutter's width spacer is a hidden marker too; only the visible ones are line numbers.
const markers = () =>
  [...view!.dom.querySelectorAll('.cm-pattern-n')].filter(
    (m) => (m.parentElement as HTMLElement).style.visibility !== 'hidden',
  );
const targetRows = () => [...view!.dom.querySelectorAll('.cm-line.cm-target-line')].map((el) => el.textContent);

describe('lineGutterExtension', () => {
  it('numbers each pattern line on its first physical line and skips setup lines', () => {
    mount(CODE, null);
    expect(markers().map((m) => m.textContent)).toEqual(['1', '2', '3']);
    // The marker sits on the line that opens the pattern: setcpm and the `.gain` continuation get none.
    const lines = patternLines(CODE);
    expect([0, 1, 2, 3, 4].map((i) => numberAt(lines, i))).toEqual([null, 1, 2, null, 3]);
    expect(markers().every((m) => !m.classList.contains('on'))).toBe(true);
  });

  it('marks the target line on, and follows a refresh', () => {
    const state = mount(CODE, 2);
    expect(markers().map((m) => m.classList.contains('on'))).toEqual([false, true, false]);
    state.target = 3;
    view!.dispatch({ effects: refreshLines.of(null) });
    expect(markers().map((m) => m.classList.contains('on'))).toEqual([false, false, true]);
  });

  it('follows the lines after an edit once refreshed', () => {
    const state = mount(CODE, null);
    view!.dispatch({ changes: { from: view!.state.doc.length, insert: '\nbass: note("c1")' } });
    state.lines = patternLines(view!.state.doc.toString());
    view!.dispatch({ effects: refreshLines.of(null) });
    expect(markers().map((m) => m.textContent)).toEqual(['1', '2', '3', '4']);
  });
});

describe('patternLineDecoration', () => {
  it('covers every physical line of the target and nothing else', () => {
    const state = mount(CODE, 2);
    expect(targetRows()).toEqual(['_fills: s("cp")', '  .gain(0.5)']);
    state.target = null;
    view!.dispatch({ effects: refreshLines.of(null) });
    expect(targetRows()).toEqual([]);
    state.target = 1;
    view!.dispatch({ effects: refreshLines.of(null) });
    expect(targetRows()).toEqual(['drums: s("bd*4")']);
  });

  it('ignores stale lines past the end of a shortened document', () => {
    const state = mount(CODE, 3);
    view!.dispatch({ changes: { from: view!.state.doc.line(4).to, to: view!.state.doc.length } });
    view!.dispatch({ effects: refreshLines.of(null) });
    expect(targetRows()).toEqual([]);
    expect(state.lines).toHaveLength(3);
  });
});
