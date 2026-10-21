# Functions in the Methods panel: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strudel's standalone functions in a second "Functions" section of the Methods panel, dropping at the pointer as complete expressions.

**Architecture:** The catalogue grows a `kind` and function rows (hand-table expressions, grouped separately); the panel renders two sections from one tree; `methodDrop.ts` adds a pointer-based insertion for functions beside the line-end one for methods.

**Tech Stack:** TypeScript, Solid, CodeMirror 6, vitest; `pnpm build-methods`.

**Spec:** `docs/superpowers/specs/2026-10-22-function-panel-design.md`

## Global Constraints

- Offline: the catalogue is committed; `samples` is denied. `orbit` never.
- Suites `pnpm exec vitest run`, `pnpm exec tsc --noEmit -p .` clean. Trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

- A function dropped with the pointer inside `"bd*4"` must refuse, not land inside the string. Task 3.
- A function dropped mid-word (`s|("bd")`) lands after the word, giving `s("bd")stack(...)`: still valid? No: it must land at the token's end only when the next character is not `(`; otherwise refuse. Task 3 pins `s|("bd")` → refuse.
- A method row that is also a function row (`stack`) keeps distinct snippets and the name is unique per kind. Task 2.
- Setup functions evaluate in the carrier with a pattern after them. Task 2.
- Search for `seq` finds the function row. Task 4.

---

### Task 1: Parser fallback for `export function` and `const`
- Test in `parseJsdoc.test.ts`: a block followed by `export function stack(...pats) {` names `stack`; one followed by `  const setCpm = (cpm) => {` names `setCpm`. RED, then extend `codeName`. Commit.

### Task 2: Function rows in the catalogue
- `catalogue.ts`: `kind`, `FUNCTION_GROUPS` re-export. `groups.ts`: `FUNCTION_GROUPS`, `FUNCTION_MEMBERS`, `FUNCTION_GROUP_OF`. `defaults.ts`: `SOURCES` += `core/repl.mjs`, `core/pick.mjs`; `Default` gains `expr?`; `FUNCTION_DEFAULTS` and `FUNCTION_DENY` tables.
- `build-methods.ts`: after the prototype check fails, look the name up on the bundles (`core`, `mini`, `tonal` exports); a function or Pattern export becomes a function row by the spec's snippet rule; the build fails naming gaps. Method rows unchanged except `kind: 'method'`. Sort: methods by `GROUPS`, then functions by `FUNCTION_GROUPS`, name within.
- Tests: `catalogue.test.ts` gains: every function row's snippet starts with its name (or, for `expr` rows, contains it), `kind` present on every row, names unique per kind, sorted by kind then group then name, `seq` and `stack` exist as functions, `samples` absent. `evaluate.test.ts`: carrier per function group, every function row plays.
- Run `pnpm build-methods` until green. Commit.

### Task 3: `insertAtPointer`
- `methodDrop.ts`: `MethodDrag.kind`; `insertAtPointer(code, offset, drag)`; `applyDrag` and `insertAtCursor` branch on kind (functions use the pointer/cursor offset). Tests first in `methodDrop.test.ts`: after `(`, after `, `, at line end, on a blank line (lands there), mid-word before `(` refuses, mid-word otherwise lands after the word, inside a string refuses, inside a comment refuses, inside a template literal refuses, selection range. Extension test: a function drag at a stubbed `posAtCoords` lands at that offset. Commit.

### Task 4: Panel sections
- `MethodPanel.tsx`: two sections with headers "Methods" and "Functions"; folders per kind; search spans both; drag payload carries `kind`. Tests: both headers render; `seq` appears under Functions › Combine; search `seq` shows only matching folders in both sections. CSS: a section header style. Commit.

### Task 5: Docs
- README Methods paragraph: the Functions section and the pointer rule. Handover: the spec and the new count. Commit.
