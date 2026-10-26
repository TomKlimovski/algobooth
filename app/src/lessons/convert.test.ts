import { convertLesson, swapSounds } from './convert';

test('swapSounds replaces unshipped sounds and banks in code, keeping sample numbers on drums', () => {
  expect(swapSounds('sound("perc:1 casio bd")')).toBe('sound("rim:1 casio bd")');
  expect(swapSounds('note("c").sound("piano gm_accordion:2")')).toBe('note("c").sound("piano gm_accordion:2")');
  expect(swapSounds('s("bd").bank("CasioRZ1")')).toBe('s("bd").bank("EmuSP12")');
  expect(swapSounds('s("bd").bank("RolandTR909")')).toBe('s("bd").bank("RolandTR909")');
});

const MDX = `---
title: T
---

import { MiniRepl } from '@src/docs/MiniRepl';

# First Sounds

Some **bold** text with \`perc\` in code and perc in prose.

<MiniRepl
  client:visible
  tune={\`sound("perc")
.room(1)\`}
  claviatureLabels={Object.fromEntries([1].map((n) => [n, n]))}
/>

<Box>

1. one
2. two

</Box>

<QA q="Click" client:visible>

the answer

</QA>

| name | example |
| ---- | ------- |
| two  | <MiniRepl client:visible tune={'$: s("bd")\\n$: note("c")'} /> |
`;

test('convertLesson takes the title from the heading and turns tags, lists and tables into blocks', () => {
  const lesson = convertLesson('first-sounds', MDX);
  expect(lesson.title).toBe('First Sounds');
  expect(lesson.blocks).toEqual([
    { kind: 'text', text: 'Some **bold** text with `rim` in code and perc in prose.' },
    { kind: 'example', code: 'sound("rim")\n.room(1)' },
    { kind: 'box', blocks: [{ kind: 'list', ordered: true, items: ['one', 'two'] }] },
    { kind: 'solution', question: 'Click', blocks: [{ kind: 'text', text: 'the answer' }] },
    { kind: 'example', code: '$: s("bd")\n$: note("c")', label: 'two' },
  ]);
});
