import data from './workshop.json';

/**
 * One piece of a lesson. Text is light markdown: `code`, **bold** and [link](url), which the panel renders
 * (a link as its text only, since the booth is offline).
 */
export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  /** Code that plays: the panel's Try button loads it onto a deck. `label` names it when it came from a table. */
  | { kind: 'example'; code: string; label?: string }
  /** Code that is only read (a list of sound names, say). */
  | { kind: 'pre'; text: string }
  /** A tip: things to try with the example above it. */
  | { kind: 'box'; blocks: Block[] }
  /** Hidden until asked for: the answer to a box's question. */
  | { kind: 'solution'; question: string; blocks: Block[] };

export interface Lesson {
  id: string;
  title: string;
  blocks: Block[];
}

export interface Workshop {
  /** Where the text came from and under which licence; the panel shows it. */
  credit: string;
  lessons: Lesson[];
}

export const workshop = data as Workshop;

/** Every playable example of a lesson, boxes and solutions included, in reading order. */
export function examples(blocks: Block[]): Extract<Block, { kind: 'example' }>[] {
  return blocks.flatMap((b) =>
    b.kind === 'example' ? [b] : b.kind === 'box' || b.kind === 'solution' ? examples(b.blocks) : [],
  );
}
