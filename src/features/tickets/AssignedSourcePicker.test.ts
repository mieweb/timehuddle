import { describe, expect, it } from 'vitest';

import { pickedAfter } from './AssignedSourcePicker';

const ids = ['main', 'redmine1.example.com', 'github.com'];

describe('pickedAfter', () => {
  it('picks every source when "All sources" is picked', () => {
    expect(pickedAfter(['*', 'main'], ids, ['main'])).toEqual(ids);
  });

  it('clears them all when "All sources" is unpicked', () => {
    expect(pickedAfter(ids, ids, ids)).toEqual([]);
  });

  it('unpicks one source from all, leaving the rest picked', () => {
    expect(pickedAfter(['*', 'main', 'github.com'], ids, ids)).toEqual(['main', 'github.com']);
  });

  it('takes a change to one source as it is', () => {
    expect(pickedAfter(['main', 'github.com'], ids, ['main'])).toEqual(['main', 'github.com']);
  });
});
