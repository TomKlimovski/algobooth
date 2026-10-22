import { BARE_LABEL, SETUP, scanLine } from '../methodDrop';

/**
 * One pattern line of a deck's code: a labelled named pattern (`drums: ...`, muted `_fills: ...`, `$: ...`) or an
 * unlabelled expression, with every physical line it continues over. `n` is 1-based; `label` has no leading
 * underscore and is null for `$:` and unlabelled lines; `from`/`to` are document offsets of the whole line (`to`
 * excludes the trailing newline); `firstLine`/`lastLine` are 0-based physical line indices.
 */
export interface PatternLine { n: number; label: string | null; muted: boolean; from: number; to: number; firstLine: number; lastLine: number }

/** Code ending in a dot, an operator, a comma or an open bracket: the expression goes on below. */
const OPEN_END = /([.,([{]|=>|[-+*/%?:=&|<>])$/;
const LABEL = /^(_?)([\w$]+):/;

/**
 * The pattern lines of `code`, numbered in document order. Setup lines (`setcpm(`, `samples(` ...), comments and
 * blanks are not pattern lines. A physical line joins the one before it while that is still open (inside a
 * template literal, or ending in `.`, an operator, a comma, an open bracket, or a bare label) or when it starts
 * with `.`, so a chain or a multi-line stack counts once.
 */
export function patternLines(code: string): PatternLine[] {
  const out: PatternLine[] = [];
  let inTemplate = false;
  let open = false;
  let offset = 0;
  code.split('\n').forEach((line, i) => {
    const startsInTemplate = inTemplate;
    const scan = scanLine(line, inTemplate);
    inTemplate = scan.inTemplate;
    const end = offset + line.length;
    const start = offset;
    offset = end + 1;
    const body = (scan.comment < 0 ? line : line.slice(0, scan.comment)).trim();
    const last = out[out.length - 1];
    if (startsInTemplate) {
      if (last) { last.to = end; last.lastLine = i; }
    } else if (body === '') {
      return; // blank or comment-only: neither starts nor ends a pattern line
    } else if (SETUP.test(body)) {
      open = false;
      return;
    } else if (last && (open || /^[.)\]}]/.test(body))) {
      last.to = end;
      last.lastLine = i;
    } else {
      const m = LABEL.exec(body);
      const label = m && m[2] !== '$' ? m[2] : null;
      out.push({ n: out.length + 1, label, muted: !!m && m[1] === '_' && label !== null, from: start, to: end, firstLine: i, lastLine: i });
    }
    open = inTemplate || BARE_LABEL.test(body) || OPEN_END.test(body);
  });
  return out;
}

/** Labels for the derived line keys: labelled lines in document order, `$:` excluded. */
export function lineLabels(lines: PatternLine[]): string[] {
  return lines.flatMap((l) => (l.label === null ? [] : [l.label]));
}

/** After the code changed: the same label if still there, else the same n clamped to 1..length, else null when there are none. */
export function refindTarget(prev: { n: number; label: string | null } | null, lines: PatternLine[]): PatternLine | null {
  if (!prev || lines.length === 0) return null;
  if (prev.label !== null) {
    const same = lines.find((l) => l.label === prev.label);
    if (same) return same;
  }
  return lines[Math.min(Math.max(prev.n, 1), lines.length) - 1];
}

/** The pattern line containing document offset `pos`, or null. */
export function lineAt(lines: PatternLine[], pos: number): PatternLine | null {
  return lines.find((l) => pos >= l.from && pos <= l.to) ?? null;
}
