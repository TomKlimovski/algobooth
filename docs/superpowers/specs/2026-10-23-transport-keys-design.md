# Transport keys and one Play/Stop button (2026-10-23)

Tom asked for the deck's Play and Stop to be one button, bound to a global hot-key, and for a few keys
reserved outside the perform letters that never change meaning, so they build muscle memory.

## The button

Each deck has one transport button: it reads **Play** when the deck is stopped and **Stop** when it plays
(lit as Play was). A click stops a playing deck, or evaluates and starts a stopped one (`DeckApi.toggle`).
Update stays as it was.

## The reserved keys

The same in edit and perform mode, while the Booth tab shows:

| Key | Does | Not while |
| --- | --- | --- |
| Cmd+Enter (Ctrl+Enter off the Mac) | play/stop the deck the keys play (the library's target) | a form field has focus |
| Space | start or stop both decks (unchanged) | typing in the editor or a field; a button has focus |
| Backquote | stop both decks; never starts anything | typing in the editor or a field |
| Tab | switch the deck the keys play (was perform-only) | edit mode with the editor focused (Tab is the editor's there) |
| Esc, F1–F8 | perform on/off, snapshots (unchanged) | |

Cmd+Enter works inside the editor too: Booth listens on the window in the capture phase and stops the
event, so CodeMirror's Mod-Enter (insert blank line) never sees it. On the Mac, Ctrl+Enter stays Strudel's
evaluate in the editor. Off the Mac, Ctrl+Enter is taken by the toggle and Alt+Enter still evaluates.

Backquote is not available in the editor, since mini-notation strings are written in backquotes. It still
works while a button has focus, because a stop key has to work right after a click.

The key strip's hint line now ends with "⌘↵ play/stop · space both · ` stop all".

## Where

`app/src/booth/transportKeys.ts` (was `spaceToggle.ts`) classifies the key; `Booth.tsx` acts on it;
`KeyController.ts` moves Tab ahead of the perform check; `Deck.tsx` has the button and `toggle`.
