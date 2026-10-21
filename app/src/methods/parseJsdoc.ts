export interface JsdocBlock {
  name: string;
  synonyms: string[];
  /** The first paragraph before any @tag, lines joined with a space, backticks kept. */
  description: string;
  params: { name: string; type: string; description: string }[];
  /** The first @example's text (lines until the next @tag or block end). */
  example: string | null;
  /** Every @tag seen: 'memberof', 'noAutocomplete', 'superdirtOnly', 'deprecated', ... */
  tags: Set<string>;
  memberof: string | null;
}

const BLOCK = /\/\*\*([\s\S]*?)\*\//g;

/** Splits a block body into its description lines and its tags (a tag runs until the next line starting with @). */
function splitBlock(body: string): { description: string[]; tags: { tag: string; text: string }[] } {
  const lines = body.split('\n').map((line) => line.replace(/^\s*\* ?/, '').replace(/\s+$/, ''));
  const description: string[] = [];
  const tags: { tag: string; lines: string[] }[] = [];
  for (const line of lines) {
    const start = /^@(\w+)\s?(.*)$/.exec(line);
    if (start) tags.push({ tag: start[1], lines: [start[2]] });
    else if (tags.length > 0) tags[tags.length - 1].lines.push(line);
    else description.push(line);
  }
  return { description, tags: tags.map((t) => ({ tag: t.tag, text: t.lines.join('\n').trim() })) };
}

function firstParagraph(lines: string[]): string {
  const start = lines.findIndex((line) => line.trim() !== '');
  if (start === -1) return '';
  const paragraph: string[] = [];
  for (const line of lines.slice(start)) {
    if (line.trim() === '') break;
    paragraph.push(line.trim());
  }
  return paragraph.join(' ');
}

/** Every `/** ... *\/` block in `source` that has an @name. */
export function parseJsdocBlocks(source: string): JsdocBlock[] {
  const blocks: JsdocBlock[] = [];
  for (const match of source.matchAll(BLOCK)) {
    const { description, tags } = splitBlock(match[1]);
    const name = tags.find((t) => t.tag === 'name')?.text;
    if (!name) continue;
    const params: JsdocBlock['params'] = [];
    for (const t of tags) {
      if (t.tag !== 'param') continue;
      const param = /^\{([^}]*)\}\s+(\S+)\s*([\s\S]*)$/.exec(t.text);
      if (param) params.push({ name: param[2], type: param[1].trim(), description: param[3].replace(/\s*\n\s*/g, ' ').trim() });
    }
    blocks.push({
      name,
      synonyms: (tags.find((t) => t.tag === 'synonyms')?.text ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      description: firstParagraph(description),
      params,
      example: tags.find((t) => t.tag === 'example')?.text ?? null,
      tags: new Set(tags.map((t) => t.tag)),
      memberof: tags.find((t) => t.tag === 'memberof')?.text ?? null,
    });
  }
  return blocks;
}

/** The ARG of the first `.name(ARG)` in `example` when ARG is one number or one quoted string literal, else null. */
export function exampleArgument(example: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const call = new RegExp(`\\.${escaped}\\(([^)]*)`).exec(example);
  if (!call) return null;
  const rest = example.slice(call.index + call[0].length);
  if (!rest.startsWith(')')) return null;
  const arg = call[1].trim();
  return /^-?(\d+\.?\d*|\.\d+)$/.test(arg) || /^"[^"]*"$/.test(arg) || /^'[^']*'$/.test(arg) ? arg : null;
}
