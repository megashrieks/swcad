import { describe, expect, it } from 'vitest';
import { bindPaths, bindTarget, resolveBinding } from './bind';

describe('label bindings', () => {
  const scope = {
    params: { title: 'Local', empty: '' },
    meta: { title: 'Document', author: 'Ada' },
  };

  it('reads a plain dotted path', () => {
    expect(resolveBinding(scope, 'meta.author')).toBe('Ada');
  });

  it('prefers the first alternative that has a value', () => {
    expect(resolveBinding(scope, 'params.title|meta.title')).toBe('Local');
    expect(resolveBinding(scope, 'params.author|meta.author')).toBe('Ada');
  });

  it('treats an empty string as unset so the fallback applies', () => {
    expect(resolveBinding(scope, 'params.empty|meta.title')).toBe('Document');
  });

  it('returns an empty string when nothing resolves', () => {
    expect(resolveBinding(scope, 'params.nope|meta.nope')).toBe('');
    expect(resolveBinding(scope, 'missing.deep.path')).toBe('');
  });

  it('coerces non-string values', () => {
    expect(resolveBinding({ params: { n: 3 } }, 'params.n')).toBe('3');
  });

  it('writes to the first path and tolerates whitespace', () => {
    expect(bindTarget('params.title|meta.title')).toBe('params.title');
    expect(bindTarget(' meta.title ')).toBe('meta.title');
    expect(bindPaths('params.a | meta.b')).toEqual(['params.a', 'meta.b']);
  });
});
