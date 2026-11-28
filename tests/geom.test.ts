import { describe, expect, it } from 'vitest';
import { circleCircleIntersections, circleFrom3, mirrorPoint, rotate, segCircleIntersections, segSegIntersection } from '../src/core/geom';
import { parseInput } from '../src/core/input';

const close = (a: readonly number[], b: readonly number[]) => {
  expect(a[0]).toBeCloseTo(b[0], 9);
  expect(a[1]).toBeCloseTo(b[1], 9);
};

describe('geom', () => {
  it('giao hai đoạn thẳng', () => {
    close(segSegIntersection([0, 0], [10, 10], [0, 10], [10, 0])!, [5, 5]);
    expect(segSegIntersection([0, 0], [1, 0], [0, 1], [1, 1])).toBeNull();
    expect(segSegIntersection([0, 0], [1, 1], [3, 0], [3, 5])).toBeNull();
  });
  it('giao đoạn thẳng với đường tròn', () => {
    const r = segCircleIntersections([-10, 0], [10, 0], [0, 0], 5);
    expect(r).toHaveLength(2);
    close(r[0], [-5, 0]);
    close(r[1], [5, 0]);
  });
  it('giao hai đường tròn', () => {
    const r = circleCircleIntersections([0, 0], 5, [8, 0], 5);
    expect(r).toHaveLength(2);
    close(r[0], [4, -3].map((v, i) => (i === 1 ? Math.abs(v) * Math.sign(r[0][1]) : v)));
  });
  it('xoay và đối xứng', () => {
    close(rotate([1, 0], [0, 0], Math.PI / 2), [0, 1]);
    close(mirrorPoint([1, 2], [0, 0], [10, 0]), [1, -2]);
  });
  it('đường tròn qua 3 điểm', () => {
    const c = circleFrom3([1, 0], [0, 1], [-1, 0])!;
    close(c.c, [0, 0]);
    expect(c.r).toBeCloseTo(1);
    expect(circleFrom3([0, 0], [1, 1], [2, 2])).toBeNull();
  });
});

describe('nhập toạ độ', () => {
  it('tuyệt đối, tương đối, cực', () => {
    expect(parseInput('100,200', null)).toEqual({ kind: 'point', p: [100, 200] });
    expect(parseInput('@10,-5', [100, 100])).toEqual({ kind: 'point', p: [110, 95] });
    const p = parseInput('@100<90', [0, 0]);
    expect(p.kind).toBe('point');
    if (p.kind === 'point') close(p.p, [0, 100]);
    expect(parseInput('2.5', null)).toEqual({ kind: 'number', n: 2.5 });
    expect(parseInput('c', null)).toEqual({ kind: 'text', s: 'c' });
    expect(parseInput('  ', null)).toEqual({ kind: 'empty' });
  });
});
