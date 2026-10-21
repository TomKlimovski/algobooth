# Functions in the Methods panel: Strudel's standalone functions as a second section

Date: 2026-10-22. Extends `2026-10-21-method-panel-design.md` (built). Tom asked for the standalone
functions too, "perhaps a new top-level header under Methods", and left the rest to me.

## Intent

`seq`, `stack`, `cat`, `sine`, `run`, `irand`, `setcpm` and the like are not chained onto a pattern, so
the panel's chainable-only rule left them out, and Tom could not find `seq` when he wanted it. They
join the same panel under a second header, with the same tooltip, the same drag, and a drop rule that
fits an expression rather than a method call.

## Goals

- A second section, **Functions**, below the method folders in the same panel, with its own folders:
  Combine, Signals, Random, Sources, Setup, Other. Search spans both sections. The deck's refusal message
  names the kind: a function refused mid-word is told where a value goes.
- Each function row carries a complete, evaluable expression as its snippet (`stack(s("bd*4"), s("hh*8"))`,
  `sine.range(200, 2000).slow(4)`, `irand(8)`, `setcpm(120/4)`), with its one tweakable literal selected.
- A function drop lands **at the pointer** when an expression can start there: after an opener (`(`, `,`,
  `:`, an operator) or nothing but spaces, and before a closer, a comment or the line's end; never inside
  a string or a comment, a word or a number, or right after an expression (those refuse: an expression
  glued to an identifier is broken either way, so there is no boundary to nudge to). On a blank line a
  Combine or Sources expression is written as its own `$:` line, since the repl plays only labelled lines
  once a deck has any; a setup call goes in bare; a signal refuses, having nothing to drive. Double-click
  inserts at the cursor the same way. (Amended after the final review.)
- The evaluate test covers functions too: each snippet, placed in a group-specific carrier
  (`s("hh*8").gain({})` for signals and random, `{}` alone for combinators and sources, `{}\n$: s("bd*4")`
  for setup), evaluates and plays.
- Documented combinators that are also chainable (`stack`, `seq`, `cat`, `fastcat`, `slowcat`, `arrange`,
  `polymeter`, `stepcat`...) were missing from the method rows because their JSDoc block precedes an
  `export function` line the parser's nameless fallback did not recognise. They join the method rows as
  methods, and the Functions section as functions, since both uses are real.

## Non-goals and anti-goals

- Anti-goal, kept: `orbit` never; and the offline principle: `samples(...)` fetches from a URL, so it is
  denied with that reason. `silence` and `gap` play nothing, and the muted-underscore convention already
  covers silencing a line, so they are denied too.
- No snippet wrapping or restructuring of the existing line (no auto `stack(` around the current pattern).
- The Rip tab's editor stays out of scope.

## The parts

1. **Parser.** `codeName` also recognises `export function x(` and `const x =` after a block.
2. **Catalogue.** `MethodDoc` gains `kind: 'method' | 'function'`. `SOURCES` adds `core/repl.mjs`
   (`setcpm`; `setcps` has no JSDoc block of its own and is not offered) and `core/pick.mjs`. A documented name that is not a `Pattern.prototype` function
   but is exported by the core, mini or tonal bundle (as a function or a Pattern object) becomes a
   function row. Its snippet is the hand table's `expr` (full text with `§` markers) when given, else
   `name(args)` from the hand table's `args`, else `name()` when the block has no params; a function with
   params and no entry fails the build with its name, like methods. Function rows are grouped by
   `FUNCTION_GROUP_OF` into `FUNCTION_GROUPS` (`Other` last) and sorted after the method rows.
3. **Panel.** Two headed sections in the one tree: "Methods" then "Functions", each with its folders and
   counts; the search box filters both. The drag payload (`MethodDrag`) gains `kind`.
4. **Drop.** `insertAtPointer(code, offset, drag)`: from the pointer offset, move right past any word or
   number characters to the token's end; refuse when that position is inside a string, inside a comment,
   or inside a template literal; otherwise insert the snippet there and select its marked literal. The
   CodeMirror extension and `insertAtCursor` branch on `drag.kind`. Method drops are unchanged.
5. **Tests.** Parser fallback; catalogue completeness per kind and sort; evaluate test per kind with the
   carriers above; `insertAtPointer` cases (mid-word, mid-number, inside a string, inside a comment, at a
   line end, at an argument boundary after `(` or `, `, on a blank line); panel renders both sections and
   search spans them; the drop extension routes by kind.

## Decided (mine; Tom said "you decide")

- One panel, two sections, rather than a second panel.
- Functions drop at the pointer, methods at the line end.
- `samples`, `silence`, `gap`, `K`, `useRNG`, `addVoicings`, `ref`, `withSeed`, the list-returning
  `binaryL`, `binaryNL`, `randL`, `parray`, the event-length meta signals `cyclesPer`, `per`, `perx` and
  `time` are denied, each with a reason in the table.
- Signals default to a unit range (`sine.range(0.2, 1).slow(4)`): safe on `.gain()` and `.pan()` in an app
  with no limiter; the tooltip gives the filter-sized form. Every Combine and Sources expression wraps its
  parts in `s()` so it sounds on its own; the pick family is denied as methods (a method lands on a sound
  pattern, which has no indices) and offered as the `pick()` and `squeeze()` functions. (After the review.)
