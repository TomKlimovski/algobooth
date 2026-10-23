import { createSignal, For, Match, Show, Switch, type JSX } from 'solid-js';
import type { DeckId } from '../booth/deckState';
import { type Block, type Lesson, workshop } from './lessons';
import './lessonPanel.css';

/** The chapter last read, kept per machine; storage may be missing or refuse, and then it starts at the first. */
const STORAGE_KEY = 'algobooth.lesson';
function savedLesson(): number {
  try {
    const i = workshop.lessons.findIndex((l) => l.id === localStorage.getItem(STORAGE_KEY));
    return Math.max(0, i);
  } catch {
    return 0;
  }
}
function saveLesson(lesson: Lesson) {
  try {
    localStorage.setItem(STORAGE_KEY, lesson.id);
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

export type Span = { kind: 'plain' | 'code' | 'bold'; text: string };

/**
 * A lesson's light markdown as spans: `code`, **bold**, and [link](url) as its text alone (the booth is
 * offline, and a link would navigate the app's window away).
 */
export function spans(text: string): Span[] {
  const out: Span[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\([^)]*\)/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ kind: 'plain', text: text.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'code', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'bold', text: m[2] });
    else out.push({ kind: 'plain', text: m[3] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ kind: 'plain', text: text.slice(at) });
  return out;
}

function Inline(props: { text: string }): JSX.Element {
  return (
    <For each={spans(props.text)}>
      {(s) => (s.kind === 'code' ? <code>{s.text}</code> : s.kind === 'bold' ? <strong>{s.text}</strong> : s.text)}
    </For>
  );
}

/**
 * The Strudel workshop beside the decks: read a chapter, press ▶ on an example to load it onto the performing
 * deck and play it, then change it there.
 */
export function LessonPanel(props: {
  /** The deck an example's ▶ loads onto (the performing deck, as the library's double-click). */
  target: () => DeckId;
  onTry: (code: string, lesson: Lesson) => void;
}) {
  const [index, setIndex] = createSignal(savedLesson());
  const lesson = () => workshop.lessons[index()];
  let body!: HTMLDivElement;
  const go = (i: number) => {
    setIndex(i);
    saveLesson(workshop.lessons[i]);
    body.scrollTop = 0;
  };

  const BlockView = (p: { block: Block }): JSX.Element => (
    <Switch>
      <Match when={p.block.kind === 'heading' && p.block}>{(b) => <h3 class="lesson-heading"><Inline text={b().text} /></h3>}</Match>
      <Match when={p.block.kind === 'text' && p.block}>{(b) => <p><Inline text={b().text} /></p>}</Match>
      <Match when={p.block.kind === 'list' && p.block}>
        {(b) => {
          const items = <For each={b().items}>{(item) => <li><Inline text={item} /></li>}</For>;
          return b().ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
        }}
      </Match>
      <Match when={p.block.kind === 'pre' && p.block}>{(b) => <pre class="lesson-pre">{b().text}</pre>}</Match>
      <Match when={p.block.kind === 'example' && p.block}>
        {(b) => (
          <div class="lesson-example">
            <Show when={b().label}>{(label) => <div class="lesson-example-label"><Inline text={label()} /></div>}</Show>
            <div class="lesson-example-row">
              <pre class="lesson-code">{b().code}</pre>
              <button
                class="lesson-try"
                title={`Load onto deck ${props.target()} and play`}
                aria-label={`play on deck ${props.target()}`}
                onClick={() => props.onTry(b().code, lesson())}
              >
                ▶ {props.target()}
              </button>
            </div>
          </div>
        )}
      </Match>
      <Match when={p.block.kind === 'box' && p.block}>
        {(b) => <div class="lesson-box"><For each={b().blocks}>{(c) => <BlockView block={c} />}</For></div>}
      </Match>
      <Match when={p.block.kind === 'solution' && p.block}>
        {(b) => (
          <details class="lesson-solution">
            <summary>{b().question}</summary>
            <For each={b().blocks}>{(c) => <BlockView block={c} />}</For>
          </details>
        )}
      </Match>
    </Switch>
  );

  return (
    <div class="lessons">
      <nav class="lessons-nav">
        <button class="lessons-step" disabled={index() === 0} onClick={() => go(index() - 1)} aria-label="previous chapter">
          ‹
        </button>
        <select
          class="lessons-chapter"
          aria-label="chapter"
          value={index()}
          onChange={(e) => go(Number(e.currentTarget.value))}
        >
          <For each={workshop.lessons}>{(l, i) => <option value={i()}>{i() + 1}. {l.title}</option>}</For>
        </select>
        <button
          class="lessons-step"
          disabled={index() === workshop.lessons.length - 1}
          onClick={() => go(index() + 1)}
          aria-label="next chapter"
        >
          ›
        </button>
      </nav>
      <div class="lessons-body" ref={body}>
        <p class="lessons-hint">
          ▶ loads an example onto deck {props.target()} (the performing deck) and plays it. Change it there and press
          Ctrl+Enter to hear the change, Ctrl+. to stop.
        </p>
        <h2 class="lessons-title">{lesson().title}</h2>
        <For each={lesson().blocks}>{(b) => <BlockView block={b} />}</For>
        <Show when={index() < workshop.lessons.length - 1}>
          <button class="lessons-next" onClick={() => go(index() + 1)}>
            Next: {workshop.lessons[index() + 1].title} ›
          </button>
        </Show>
        <p class="lessons-credit">{workshop.credit}</p>
      </div>
    </div>
  );
}
