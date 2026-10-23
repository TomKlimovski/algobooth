import { render } from 'solid-js/web';
import { LessonPanel, spans } from './LessonPanel';
import { examples, workshop } from './lessons';

let dispose = () => {};
let root: HTMLDivElement;
const onTry = vi.fn();

beforeEach(() => {
  localStorage.clear();
  onTry.mockReset();
  root = document.createElement('div');
  document.body.append(root);
  dispose = render(() => <LessonPanel target={() => 'B'} onTry={onTry} />, root);
});
afterEach(() => {
  dispose();
  root.remove();
});

const title = () => root.querySelector('.lessons-title')!.textContent;
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

test('spans reads code, bold and links (as text)', () => {
  expect(spans('a `b` **c** [d](/e) f')).toEqual([
    { kind: 'plain', text: 'a ' },
    { kind: 'code', text: 'b' },
    { kind: 'plain', text: ' ' },
    { kind: 'bold', text: 'c' },
    { kind: 'plain', text: ' ' },
    { kind: 'plain', text: 'd' },
    { kind: 'plain', text: ' f' },
  ]);
});

test('opens on the first chapter and steps to the next, remembering it', () => {
  expect(title()).toBe(workshop.lessons[0].title);
  click(root.querySelector('[aria-label="next chapter"]')!);
  expect(title()).toBe(workshop.lessons[1].title);
  expect(localStorage.getItem('algobooth.lesson')).toBe(workshop.lessons[1].id);
});

test('an example’s ▶ names the target deck and hands its code and lesson over', () => {
  click(root.querySelector('[aria-label="next chapter"]')!);
  const play = root.querySelector('.lesson-try')!;
  expect(play.textContent).toContain('B');
  click(play);
  expect(onTry).toHaveBeenCalledWith(examples(workshop.lessons[1].blocks)[0].code, workshop.lessons[1]);
});
