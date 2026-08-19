import { describe, expect, it } from 'vitest';
import { AlignmentIndex, SpatialHash } from './index';

describe('AlignmentIndex', () => {
  it('indexes rect edges and centres', () => {
    const index = new AlignmentIndex();
    index.updateRect('a', { x: 10, y: 20, w: 100, h: 40 });

    expect(index.queryX(10, 0.5).map((h) => h.coord)).toEqual([10]);
    expect(index.queryX(60, 0.5).map((h) => h.coord)).toEqual([60]);
    expect(index.queryX(110, 0.5).map((h) => h.coord)).toEqual([110]);
    expect(index.queryY(40, 0.5).map((h) => h.coord)).toEqual([40]);
  });

  it('removes stale coordinates when a source moves', () => {
    const index = new AlignmentIndex();
    index.updateRect('a', { x: 0, y: 0, w: 50, h: 50 });
    index.updateRect('a', { x: 200, y: 0, w: 50, h: 50 });

    expect(index.queryX(0, 1)).toHaveLength(0);
    expect(index.queryX(200, 1).map((h) => h.sources)).toEqual([['a']]);
  });

  it('merges sources that share a coordinate and splits them again', () => {
    const index = new AlignmentIndex();
    index.updateRect('a', { x: 100, y: 0, w: 20, h: 20 });
    index.updateRect('b', { x: 100, y: 300, w: 20, h: 20 });

    expect(index.queryX(100, 0.5)[0].sources.sort()).toEqual(['a', 'b']);

    index.updateRect('b', { x: 400, y: 300, w: 20, h: 20 });
    expect(index.queryX(100, 0.5)[0].sources).toEqual(['a']);
  });

  it('excludes the dragged source from its own guides', () => {
    const index = new AlignmentIndex();
    index.updateRect('a', { x: 100, y: 0, w: 20, h: 20 });
    index.updateRect('b', { x: 100, y: 300, w: 20, h: 20 });

    const hits = index.queryX(100, 2, new Set(['a']));
    expect(hits).toHaveLength(1);
    expect(hits[0].sources).toEqual(['b']);
  });

  it('sorts hits by distance and honours tolerance', () => {
    const index = new AlignmentIndex();
    index.update('a', { xs: [10], ys: [] });
    index.update('b', { xs: [14], ys: [] });
    index.update('c', { xs: [80], ys: [] });

    const hits = index.queryX(13, 5);
    expect(hits.map((h) => h.coord)).toEqual([14, 10]);
    expect(index.queryX(13, 1).map((h) => h.coord)).toEqual([14]);
  });

  it('drops every coordinate on remove', () => {
    const index = new AlignmentIndex();
    index.updateRect('a', { x: 5, y: 5, w: 10, h: 10 });
    index.remove('a');

    expect(index.size).toBe(0);
    expect(index.queryX(5, 10)).toHaveLength(0);
    expect(index.columnsIn(-1000, 1000)).toHaveLength(0);
  });

  it('stays consistent under randomised churn', () => {
    const index = new AlignmentIndex();
    const live = new Map<string, number>();
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let i = 0; i < 400; i += 1) {
      const id = `n${Math.floor(rnd() * 25)}`;
      if (rnd() < 0.25 && live.has(id)) {
        index.remove(id);
        live.delete(id);
      } else {
        const x = Math.floor(rnd() * 10) * 10;
        index.update(id, { xs: [x], ys: [] });
        live.set(id, x);
      }
    }

    for (let coord = 0; coord <= 90; coord += 10) {
      const expected = [...live.entries()].filter(([, x]) => x === coord).map(([id]) => id);
      const hit = index.queryX(coord, 0.5)[0];
      expect((hit?.sources ?? []).sort()).toEqual(expected.sort());
    }
  });
});

describe('SpatialHash', () => {
  it('returns candidates overlapping a query rect', () => {
    const hash = new SpatialHash(50);
    hash.update('a', { x: 0, y: 0, w: 40, h: 40 });
    hash.update('b', { x: 500, y: 500, w: 40, h: 40 });

    expect(hash.query({ x: -10, y: -10, w: 30, h: 30 })).toEqual(['a']);
    expect(hash.query({ x: 490, y: 490, w: 30, h: 30 })).toEqual(['b']);
    expect(hash.query({ x: 200, y: 200, w: 10, h: 10 })).toEqual([]);
  });

  it('clears old buckets on move and on remove', () => {
    const hash = new SpatialHash(50);
    hash.update('a', { x: 0, y: 0, w: 10, h: 10 });
    hash.update('a', { x: 400, y: 400, w: 10, h: 10 });
    expect(hash.query({ x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
    expect(hash.query({ x: 400, y: 400, w: 10, h: 10 })).toEqual(['a']);

    hash.remove('a');
    expect(hash.query({ x: 400, y: 400, w: 10, h: 10 })).toEqual([]);
  });

  it('produces stable bucket keys usable as dependency keys', () => {
    const hash = new SpatialHash(100);
    expect(hash.keysFor({ x: 0, y: 0, w: 10, h: 10 })).toEqual(['0,0']);
    expect(hash.keysFor({ x: 90, y: 90, w: 20, h: 20 }).sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });
});
