# Global start/stop and update keys (2026-10-28)

Tom asked for start/stop and update on keys that are always assigned while Algobooth is the active app,
and that no other part of the app ever uses. He first suggested F8/F9, but on the Mac those are the
media keys: without fn they go to macOS (and Music or Spotify) and never reach the app, and F7/F8 are
snapshot slots. He then asked for single left-hand keys around Z and X. Bare letters would take typing and
the line pads; Shift would take capital letters and the nudge up; Ctrl is undo and cut on Windows and the
nudge down in perform mode. He chose Option (Alt off the Mac), which the method keyboard already ignores.

## The keys

| Mac | Windows / Linux | Does |
| --- | --- | --- |
| Option+Z | Alt+Z | play/stop the performing deck (the library's target): the deck's Play/Stop button |
| Option+X | Alt+X | update the performing deck: the deck's Update button (re-evaluate, keep playing or stopped as it was) |

Matched by physical key (`KeyZ`, `KeyX`) with Alt and no other modifier, so they sit in the same place on
any layout (on the Mac `e.key` is Ω or ≈, so the code is what to match). Cmd+Enter stays as a second
play/stop, unchanged.

## Always assigned

Both keys work on every tab (Booth, Rip, Settings), in edit and perform mode, with any focus: the
editor, a form field, a button. They act on the booth's performing deck everywhere, so they mean the
same thing wherever you are; on the Rip tab they do not drive the rip result (its own Play does that).
Key repeat is swallowed and does nothing, so holding the key neither flaps the deck nor types.

Booth already listens on the window in the capture phase; it prevents the default and stops the event for
these two keys, so CodeMirror, form fields and the method keyboard never see them.

## What they cost

Option+Z and Option+X no longer type Ω and ≈ on the Mac. Nothing in the app binds Alt+Z or Alt+X: the
method keyboard returns early on Alt+letter, and CodeMirror and Strudel bind neither.

Space, Backquote, Tab, Esc, F1–F8 and Cmd+Enter are unchanged; the first five stay Booth-only.

## Where

`app/src/booth/transportKeys.ts` gets a `globalKey` classifier ('toggle' | 'update') that ignores the tab and
the focus; `Booth.tsx` checks it first in its capture-phase handler and calls the performing deck's `toggle()`
or `evaluate(false)`; the Play/Stop and Update buttons' tooltips name the keys; the key strip's hint line
adds "⌥Z play/stop · ⌥X update".
