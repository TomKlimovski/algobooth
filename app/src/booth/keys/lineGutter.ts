import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import { Decoration, EditorView, gutter, GutterMarker, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { PatternLine } from './lines';

/**
 * Tells the gutter and the target decoration to read their getters again. The lines and the target live in
 * Solid stores outside the editor, and they change after the editor's own update (the deck's `liveCode`
 * follows the doc from an update listener), so the deck dispatches this whenever either changes.
 */
export const refreshLines = StateEffect.define<null>();

const refreshed = (u: ViewUpdate) => u.transactions.some((t) => t.effects.some((e) => e.is(refreshLines)));

/** The pattern number shown on 0-based physical line `index`: only a pattern line's first line has one. */
export function numberAt(lines: PatternLine[], index: number): number | null {
  return lines.find((l) => l.firstLine === index)?.n ?? null;
}

class NumberMarker extends GutterMarker {
  constructor(
    readonly n: number,
    readonly on: boolean,
  ) {
    super();
  }
  eq(other: NumberMarker) {
    return other.n === this.n && other.on === this.on;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = this.on ? 'cm-pattern-n on' : 'cm-pattern-n';
    el.textContent = String(this.n);
    return el;
  }
}

/**
 * The pattern-line gutter, in place of CodeMirror's line numbers: the number a digit key targets, on the line
 * that opens each pattern, lit for the target. Setup lines, comments and a chain's continuation lines get none,
 * so the numbers are the digits, not the document's line count.
 */
export function lineGutterExtension(lines: () => PatternLine[], target: () => number | null): Extension {
  return gutter({
    class: 'cm-pattern-gutter',
    lineMarker: (view, block) => {
      const n = numberAt(lines(), view.state.doc.lineAt(block.from).number - 1);
      return n === null ? null : new NumberMarker(n, n === target());
    },
    lineMarkerChange: refreshed,
    // Two digits wide from the start, so the gutter does not jump when a tenth pattern line appears.
    initialSpacer: () => new NumberMarker(99, false),
  });
}

/**
 * Tints every physical line of the target pattern line (`cm-target-line`), so a multi-line stack reads as one
 * target. Lines past the end of the document are skipped: the lines can lag the doc by one update.
 */
export function patternLineDecoration(lines: () => PatternLine[], target: () => number | null): Extension {
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    const t = target();
    const line = t === null ? undefined : lines().find((l) => l.n === t);
    const doc = view.state.doc;
    if (line) {
      for (let i = line.firstLine; i <= line.lastLine && i < doc.lines; i++) {
        builder.add(doc.line(i + 1).from, doc.line(i + 1).from, TARGET);
      }
    }
    return builder.finish();
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || refreshed(u)) this.decorations = build(u.view);
      }
    },
    { decorations: (p) => p.decorations },
  );
}

const TARGET = Decoration.line({ class: 'cm-target-line' });
