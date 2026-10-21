# Method panel: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Methods panel on the right of the Booth listing Strudel's chainable methods in folders, with hover descriptions, that can be dragged onto a deck editor to land as `.name(default)` at the end of the dropped-on line.

**Architecture:** A dev-time script parses the JSDoc in the pinned Strudel sources into a committed `catalogue.json` (names, descriptions, synonyms, snippets, groups). A Solid panel renders the catalogue and starts drags carrying a private MIME type. A pure `insertAtLineEnd` decides where a snippet lands; a CodeMirror drop handler appended to each deck's editor applies it. A vitest test evaluates every snippet with the real Strudel bundles.

**Tech Stack:** TypeScript, Solid 1.9, CodeMirror 6 (via `@strudel/codemirror` 1.3.0), `@strudel/core` and `@strudel/tonal` 1.2.6, vitest 5 with jsdom, tsx for the script.

**Spec:** `docs/superpowers/specs/2026-10-21-method-panel-design.md`

## Global Constraints

- Offline: nothing fetched at run time; `catalogue.json` is committed.
- `orbit` never appears in the catalogue.
- Nothing evaluates on drop; every evaluation still goes through `evalLock`.
- Suites: `pnpm exec vitest run`, `pnpm exec tsc --noEmit -p .` clean.
- WebKit: `setTimeout` and `fetch` called unbound (see `ripApi.ts`); the library tree's drag and hover patterns are the model.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and nothing else.

## Review Focus

- A drop on a line that ends with `;` keeps the `;` after the snippet; a drop on a line with a trailing `// comment` lands before the comment. Pinned in Task 3.
- A drop with the private MIME whose target resolves to no line (a document of only comments) must still `preventDefault`, or CodeMirror inserts the `text/plain` copy wherever the pointer was. Pinned in Task 5.
- A method whose default does not sound on the default base (the voicing family) must sound on its own base, and the tooltip must say so. Pinned in Task 2.
- Search with no matches hides every folder rather than showing empty headers. Pinned in Task 4.
- Bumping Strudel without re-running the script must fail a test, not silently ship stale docs. Pinned in Task 2.

---

### Task 1: The JSDoc parser

**Files:**
- Create: `app/src/methods/parseJsdoc.ts`, `app/src/methods/parseJsdoc.test.ts`

**Interfaces:**
- Produces:

```ts
export interface JsdocBlock {
  name: string;            // @name, or null-filtered out
  synonyms: string[];      // @synonyms, comma separated, trimmed
  description: string;     // first paragraph before any @tag, lines joined with a space, backticks kept
  params: { name: string; type: string; description: string }[]; // @param {type} name description
  example: string | null;  // first @example's text (lines until the next @tag or block end)
  tags: Set<string>;       // every @tag seen: 'memberof', 'noAutocomplete', 'superdirtOnly', 'deprecated', ...
  memberof: string | null; // @memberof value
}
export function parseJsdocBlocks(source: string): JsdocBlock[];   // every /** ... */ block that has an @name
export function exampleArgument(example: string, name: string): string | null;
// the ARG of the first `.name(ARG)` in example when ARG is one number or one quoted string literal, else null
```

- [ ] **Step 1: Write the failing tests**

Fixture: a string with three blocks: (a) `duckattack` as in `controls.mjs` (description two paragraphs, `@synonyms duckatt`, one `@param {number | Pattern} time The attack time in seconds`, two `@example`s, the first containing `.duckattack("<0.2 0 0.4>")`); (b) a `@memberof Pattern` block `rev` with no params and example `s("bd hh").rev()`; (c) a block with `@noAutocomplete` and no `@name`.

```ts
test('parses name, synonyms, first paragraph, params and first example', () => {
  const [duck, rev] = parseJsdocBlocks(FIXTURE);
  expect(duck.name).toBe('duckattack');
  expect(duck.synonyms).toEqual(['duckatt']);
  expect(duck.description).toBe('The time required for the ducked signal(s) to return to their normal volume.');
  expect(duck.params).toEqual([{ name: 'time', type: 'number | Pattern', description: 'The attack time in seconds' }]);
  expect(duck.example).toContain('duckattack("<0.2 0 0.4>")');
  expect(rev.memberof).toBe('Pattern');
  expect(rev.params).toEqual([]);
});
test('a block without @name is skipped and tags are collected', () => {
  expect(parseJsdocBlocks(FIXTURE)).toHaveLength(2);
  expect(parseJsdocBlocks('/**\n * x\n * @name foo\n * @superdirtOnly\n */')[0].tags.has('superdirtOnly')).toBe(true);
});
test('exampleArgument takes one literal and refuses anything else', () => {
  expect(exampleArgument('s("bd").lpf(800)', 'lpf')).toBe('800');
  expect(exampleArgument('n(1).lpenv(8).lpf(150)', 'lpenv')).toBe('8');
  expect(exampleArgument('s("bd").duckattack("<0.2 0 0.4>")', 'duckattack')).toBe('"<0.2 0 0.4>"');
  expect(exampleArgument('s("bd").euclid(3,8)', 'euclid')).toBeNull();
  expect(exampleArgument('s("bd").off(1/8, x => x)', 'off')).toBeNull();
  expect(exampleArgument('s("bd").rev()', 'rev')).toBeNull();
  expect(exampleArgument('s("bd").lpfx(1)', 'lpf')).toBeNull();
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm exec vitest run app/src/methods/parseJsdoc.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `parseJsdoc.ts`**

A hand-rolled scanner: find `/** ... */` blocks, strip leading ` * `, split into the description (lines before the first `@`) and tag lines (a tag runs until the next line starting with `@`). No dependencies.

- [ ] **Step 4: Run to see them pass**

Run: `pnpm exec vitest run app/src/methods/parseJsdoc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/methods/parseJsdoc.ts app/src/methods/parseJsdoc.test.ts
git commit -m "A JSDoc block scanner for Strudel's sources"
```

---

### Task 2: Defaults, groups, the build script and the catalogue

**Files:**
- Create: `app/src/methods/defaults.ts`, `app/src/methods/groups.ts`, `app/src/methods/catalogue.ts`, `app/src/methods/catalogue.json`, `scripts/build-methods.ts`, `app/src/methods/catalogue.test.ts`, `app/src/methods/evaluate.test.ts`
- Modify: `package.json` (script `"build-methods": "tsx scripts/build-methods.ts"`)

**Interfaces:**
- Produces, in `catalogue.ts`:

```ts
export interface MethodDoc {
  name: string; synonyms: string[]; description: string;
  params: { name: string; type: string; description: string }[];
  snippet: string;                      // `.duckattack(0.2)`
  argRange: [number, number] | null;    // offsets within snippet
  group: string; source: string;        // e.g. '@strudel/core/controls.mjs'
  note: string | null;                  // extra tooltip line, e.g. 'needs a chord() pattern'
  base: string | null;                  // evaluate-test base override, from defaults.ts
}
export interface Catalogue { versions: Record<string, string>; methods: MethodDoc[] }  // versions: {'@strudel/core': '1.2.6', '@strudel/tonal': '1.2.6'}
export const catalogue: Catalogue;      // `import json from './catalogue.json'`
export const GROUPS: string[];          // panel order, 'Other' last (re-exported from groups.ts)
```

- In `defaults.ts`:

```ts
/** name → argument text with the selectable literal between § signs; optional base for the evaluate test, optional tooltip note. */
export const DEFAULTS: Record<string, { args: string; base?: string; note?: string }>;
export const DENY: Record<string, string>;   // name → one-line reason
export const SOURCES: string[];              // the five .mjs files, package-relative
```

- In `groups.ts`: `export const GROUPS = ['Sound','Pitch','Filter','Envelope','Dynamics','Ducking','Delay and Reverb','Modulation','Distortion','Pan and Space','Time','Structure','Other']` and `export const GROUP_OF: Record<string, string>` with the spec's table (part 2) as the starting map; `panspan`, not `pansweep`.

- [ ] **Step 1: Write `defaults.ts`, `groups.ts`**

`DENY` holds the spec's list with reasons: `orbit`, `p`, `q`, `hush`, `pianoroll`, `punchcard`, `scope`, `spiral`, `pitchwheel`, `markcss`, `color`, `log`, `logValues`, `analyze`, `keyDown`, `whenKey`, `bypass`. `DEFAULTS` starts with the multi-argument and callback methods the spec names (`every`, `off`, `euclid`, `range`, `swingBy`, `echo`, `layer`, `superimpose`, `jux`, `juxBy`, `sometimesBy`, `degradeBy`, `struct`, `mask`, `when`, `firstOf`, `lastOf`, `segment`, `chop`, `striate`, `ply`, `iter`, `add`, `sub`, `mul`, `div`, `scale`, `transpose`, `voicing`, `voicings`, `rootNotes`, `bank`, `s`, `n`, `note`) and the Ducking note `orbits here are decks: 1 = deck A, 2 = deck B` on the four duck methods. The voicing family gets `base: 'chord("<C^7 Dm7>")'` and `note: 'needs a chord() pattern'`. The script's failure list (Step 4) says what else to add.

- [ ] **Step 2: Write `scripts/build-methods.ts`**

For each file in `SOURCES`, read it from `node_modules`, `parseJsdocBlocks`, and keep a block when: it is not in `DENY`, has none of `noAutocomplete`, `superdirtOnly`, `deprecated`, and its name is a function on `Pattern.prototype` (import `Pattern` from `@strudel/core/dist/index.mjs`; also import `@strudel/tonal/dist/index.mjs` for its side effects before checking). Snippet: `.` + name + `(` + args + `)` where args is, in order, `DEFAULTS[name].args` with `§` stripped (argRange from the markers), `exampleArgument(block.example, name)` (argRange the whole literal), or empty when `params.length === 0`. A kept block with params and no args: collect its name and after the loop throw with the list, so the run fails naming every gap at once. Group: `GROUP_OF[name] ?? 'Other'`. Sort by `GROUPS` index then name. Write `{ versions, methods }` to `app/src/methods/catalogue.json` with two-space indent and a trailing newline. Print the `Other` names.

- [ ] **Step 3: Add the package script and run it**

Run: `pnpm build-methods`
Expected: it throws, naming methods with parameters and no default.

- [ ] **Step 4: Extend `DEFAULTS` until the script succeeds**

For each named method, choose an audible, mid-range default from its JSDoc (read the block in `node_modules`); re-run until it writes the file. Commit the resulting `Other` list in a comment at the top of `groups.ts` and move any that clearly belong in a group.

- [ ] **Step 5: Write `catalogue.test.ts`**

```ts
test('the catalogue matches the installed Strudel', async () => {
  const core = await import('@strudel/core/package.json'); const tonal = await import('@strudel/tonal/package.json');
  expect(catalogue.versions, 'run `pnpm build-methods`').toEqual({ '@strudel/core': core.version, '@strudel/tonal': tonal.version });
});
test('orbit is never offered and every row is complete', () => {
  const names = catalogue.methods.map((m) => m.name);
  expect(names).not.toContain('orbit');
  for (const m of catalogue.methods) {
    expect(m.description.length, m.name).toBeGreaterThan(0);
    expect(m.snippet.startsWith(`.${m.name}(`), m.name).toBe(true);
    if (m.argRange) expect(m.snippet.slice(...m.argRange).length).toBeGreaterThan(0);
  }
});
test('every grouped name exists and the voicing family carries its note', () => {
  const names = new Set(catalogue.methods.map((m) => m.name));
  for (const n of Object.keys(GROUP_OF)) expect(names.has(n), n).toBe(true);
  expect(catalogue.methods.find((m) => m.name === 'voicing')?.note).toBe('needs a chord() pattern');
});
test('the catalogue is sorted by group then name', () => { /* compare to a sorted copy */ });
```

(`resolveJsonModule` may need enabling in `tsconfig.json`; the package.json imports can instead read the files through `import.meta.glob` with `?raw` if vite refuses them.)

- [ ] **Step 6: Write `evaluate.test.ts`**

Setup copied from `app/src/rip/roundtrip.test.ts` (webaudio mock, bundles, `evalScope`). Base per row: `m.base ?? (m.group === 'Pitch' ? 'note("c3 e3 g3 c4").s("sawtooth")' : 's("bd*4").bank("tr909")')`.

```ts
test.each(catalogue.methods.map((m) => [m.name, m]))('%s evaluates and sounds with its default', async (_n, m) => {
  const r = core.repl({ transpiler, defaultOutput: async () => {}, getTime: () => 0 });
  const pat = await r.evaluate(base(m) + m.snippet, false);
  const haps = (pat ?? r.scheduler.pattern).queryArc(0, 1).filter((h: any) => h.whole);
  expect(haps.length, `${base(m)}${m.snippet}`).toBeGreaterThan(0);
});
```

- [ ] **Step 7: Run both tests; fix defaults or deny until green**

Run: `pnpm exec vitest run app/src/methods`
Expected: PASS for every row. A failing row gets a better default in `DEFAULTS`, a `base`, or, only under the spec's rule (cannot sound on any base), a `DENY` entry with its reason. Re-run `pnpm build-methods` after each change.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm exec tsc --noEmit -p .`
Expected: clean.

```bash
git add app/src/methods scripts/build-methods.ts package.json tsconfig.json
git commit -m "The method catalogue: Strudel's chainable methods with defaults, built from its JSDoc"
```

---

### Task 3: Where a snippet lands

**Files:**
- Create: `app/src/booth/methodDrop.ts`, `app/src/booth/methodDrop.test.ts`

**Interfaces:**
- Produces:

```ts
export const METHOD_MIME = 'application/x-algobooth-method';
export interface MethodDrag { name: string; snippet: string; argRange: [number, number] | null }  // the MIME's JSON
export function insertAtLineEnd(code: string, lineIndex: number, drag: MethodDrag): { code: string; selection: [number, number] | null } | null;
```

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm exec vitest run app/src/booth/methodDrop.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `insertAtLineEnd`**

Trailing comment detection: the first `//` outside a string on the line (walk the line tracking `"`, `'` and backtick quoting). Insertion point: before that comment, before trailing whitespace, before a single trailing `;`.

- [ ] **Step 4: Run to see them pass; commit**

Run: `pnpm exec vitest run app/src/booth/methodDrop.test.ts`
Expected: PASS.

```bash
git add app/src/booth/methodDrop.ts app/src/booth/methodDrop.test.ts
git commit -m "insertAtLineEnd: where a dropped method lands"
```

---

### Task 4: The panel

**Files:**
- Create: `app/src/booth/MethodPanel.tsx`, `app/src/booth/MethodPanel.test.tsx`, `app/src/booth/methodPanel.css`
- Modify: `app/src/booth/Booth.tsx` (an `<aside class="booth-methods">` after `.booth-main`), `app/src/booth/booth.css` (`.booth-methods { flex: 0 0 210px; border-left: 1px solid #2a2d36; }`)

**Interfaces:**
- Consumes: `catalogue`, `GROUPS` (Task 2); `METHOD_MIME`, `MethodDrag` (Task 3); `PREVIEW_DELAY_MS` from `library/LibraryTree.tsx`.
- Produces: `export function MethodPanel(props: { onInsert?: (drag: MethodDrag) => void })` (double-click calls `onInsert`). Rows have class `method-row` and `data-name`; folders `method-folder` with `aria-expanded`; the tooltip `method-tip`; the search input `method-search`.

- [ ] **Step 1: Write the failing tests** (mount with `render` as in `LibraryTree.test.tsx`)

```ts
test('renders the groups in order, collapsed, and expands one on click', ...);   // GROUPS that have members appear as folders; no .method-row visible until a folder is clicked
test('search filters rows by name, synonym and description, expanding matching folders and hiding empty ones', ...);  // type 'duckatt' → one folder shown, row duckattack visible; type 'zzzz' → no folders
test('dragstart carries both MIME types', ...);  // a fake DataTransfer with setData; expect text/plain = snippet and METHOD_MIME = JSON of {name, snippet, argRange}
test('resting the pointer shows the description, synonyms and note; leaving hides it', ...);  // fake timers, PREVIEW_DELAY_MS, .method-tip textContent contains description and 'also: duckatt'
test('double-click calls onInsert with the row', ...);
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm exec vitest run app/src/booth/MethodPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `MethodPanel.tsx` and its CSS**

Signals: `query`, `open: Set<string>` (folder names), `tip: { name; x; y } | null` with a timer as in `LibraryTree` (`clearTimeout`/`setTimeout` unbound). Tooltip positioned at `rect.left - 8` and `rect.top`, translated left by its own width (`transform: translateX(-100%)`). Tooltip content: the snippet in a `<code>`, the description, `also: ` plus synonyms when any, one `name: type` line per param, the `note` when any. Rows: `draggable`, `tabindex=0`, `onDragStart`, `onMouseEnter`/`onMouseLeave`, `onFocus`/`onBlur`, `onDblClick`. Styles follow `library.css` (`.lib-row`, `.lib-preview`) in colour and size.

- [ ] **Step 4: Wire into `Booth.tsx`**

After `</main>`: `<aside class="booth-methods"><MethodPanel onInsert={(d) => booth.state.decks[props.library.state.target]?.insertSnippet(d)} /></aside>` (`insertSnippet` arrives in Task 5; until then pass `onInsert={() => {}}` and leave a `// Task 5` marker, or do Tasks 4 and 5 in one commit).

- [ ] **Step 5: Run the panel tests, typecheck, look at it**

Run: `pnpm exec vitest run app/src/booth/MethodPanel.test.tsx && pnpm exec tsc --noEmit -p .`
Expected: PASS, clean. Then `pnpm tauri dev` (or `pnpm dev` in a browser) and check the panel sits at the right edge, folders open, the tooltip appears to the left of the row and does not run off screen.

- [ ] **Step 6: Commit**

```bash
git add app/src/booth/MethodPanel.tsx app/src/booth/MethodPanel.test.tsx app/src/booth/methodPanel.css app/src/booth/Booth.tsx app/src/booth/booth.css
git commit -m "The Methods panel: Strudel's chainable methods in folders, with hover descriptions"
```

---

### Task 5: The drop into a deck

**Files:**
- Modify: `app/src/booth/Deck.tsx` (`DeckApi`, the mirror's extension, `onReady`), `app/src/booth/Booth.tsx` (the Task 4 marker)
- Test: `app/src/booth/methodDrop.test.ts` (add the CodeMirror-level test), or a new `app/src/booth/deckDrop.test.ts`

**Interfaces:**
- Consumes: `insertAtLineEnd`, `METHOD_MIME`, `MethodDrag` (Task 3).
- Produces: on `DeckApi`, `insertSnippet(drag: MethodDrag): boolean` (inserts at the cursor's line through `insertAtLineEnd`; false when refused). A helper in `methodDrop.ts`:

```ts
export function methodDropExtension(view: () => EditorView, onRefused: () => void): Extension;
// EditorView.domEventHandlers: dragover allows a drop when METHOD_MIME is among the types; drop reads the MIME, lineIndex from
// view.state.doc.lineAt(view.posAtCoords({x: e.clientX, y: e.clientY}) ?? view.state.doc.length).number - 1, applies insertAtLineEnd,
// dispatches { changes, selection }, focuses the view; always preventDefault when METHOD_MIME is present; onRefused on null.
```

- [ ] **Step 1: Write the failing test**

Build a real `EditorView` from `@codemirror/view` (already a dependency through `@strudel/codemirror`; add it to `strudel-modules.d.ts` only if types are missing) with `methodDropExtension`; dispatch a synthetic `drop` with a fake `dataTransfer` whose `types` include `METHOD_MIME`; assert the doc, the selection, `defaultPrevented`, and `onRefused` on a comment-only doc. jsdom has no layout, so stub `view.posAtCoords` to return a position on line 2.

- [ ] **Step 2: Run to see it fail**

Run: `pnpm exec vitest run app/src/booth/methodDrop.test.ts`
Expected: FAIL, `methodDropExtension` not exported.

- [ ] **Step 3: Implement `methodDropExtension` and wire it in `Deck.tsx`**

After the mirror is built: `mirror.editor.dispatch({ effects: StateEffect.appendConfig.of(methodDropExtension(() => mirror.editor, () => deck.setError('drop onto a pattern line'))) })`. The deck's existing capture-phase `onDrop` returns early without `PATTERN_MIME`, so a method drop reaches CodeMirror; confirm `accepts` does not `preventDefault` a method drag in `onDragOver` (it only acts on `PATTERN_MIME`). Add `insertSnippet` to `DeckApi` and `onReady` using the cursor's line (`doc.lineAt(state.selection.main.head)`). Call `props.onUse?.()` on a successful drop so the deck becomes the library target.

- [ ] **Step 4: Replace the Task 4 marker in `Booth.tsx`** with the `insertSnippet` call.

- [ ] **Step 5: Run the suites and try it by hand**

Run: `pnpm exec vitest run && pnpm exec tsc --noEmit -p .`
Expected: all pass, clean. In the app: drag `lpf` from the panel onto deck A's first pattern line, see `.lpf(800)` appended with `800` selected, press Update, hear the filter; drop on the header comment line and see the snippet land on the line below's nearest pattern line above (or the refusal message); double-click `rev` and see `.rev()` land on the cursor's line in the target deck; the dirty dot appears after a drop.

- [ ] **Step 6: Commit**

```bash
git add app/src/booth/Deck.tsx app/src/booth/Booth.tsx app/src/booth/methodDrop.ts app/src/booth/methodDrop.test.ts
git commit -m "Dropping a method onto a deck lands it at the end of the line"
```

---

### Task 6: Documentation

**Files:**
- Modify: `README.md` (the Booth section: a paragraph on the Methods panel, drag, double-click, hover, `pnpm build-methods` after a Strudel bump), `docs/handover-2026-10-21.md` ("Where things live": `app/src/methods/` and `app/src/booth/MethodPanel.tsx`, `methodDrop.ts`; a gotcha line: re-run `pnpm build-methods` when Strudel is bumped or `catalogue.test.ts` fails).

- [ ] **Step 1: Write the two passages; commit**

```bash
git add README.md docs/handover-2026-10-21.md
git commit -m "Document the Methods panel"
```
