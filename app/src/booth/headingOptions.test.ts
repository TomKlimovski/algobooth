import type { TreeNode } from '../library/api';
import { headingOptions } from './SaveDialog';

const heading = (path: string, children: TreeNode[] = []): TreeNode => ({ name: path, path, kind: 'heading', cpm: null, children });
const tree = heading('', [heading('mine')]);

test('the requested heading is offered as new when the tree lacks it', () => {
  expect(headingOptions(tree, 'ripped')).toEqual([
    { path: '', label: 'library (top)' },
    { path: 'mine', label: 'mine' },
    { path: 'ripped', label: 'ripped (new)' },
  ]);
});

test('an existing or root heading is not duplicated', () => {
  expect(headingOptions(tree, 'mine').map((o) => o.path)).toEqual(['', 'mine']);
  expect(headingOptions(tree, '').map((o) => o.path)).toEqual(['', 'mine']);
  expect(headingOptions(null, 'ripped').map((o) => o.path)).toEqual(['', 'ripped']);
});
