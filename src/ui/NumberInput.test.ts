import { describe, expect, it } from 'vitest';
import { formatNumber, isPartialNumber, parseNumber } from './NumberInput';

describe('parseNumber', () => {
  it('accepts a finished number', () => {
    expect(parseNumber('137.25')).toBe(137.25);
    expect(parseNumber('-40.5')).toBe(-40.5);
    expect(parseNumber('0')).toBe(0);
  });

  it('holds its fire while the text is only on the way to a number', () => {
    // An emptied field used to commit 0 and teleport the node to the origin.
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('-')).toBeNull();
    expect(parseNumber('.')).toBeNull();
    expect(parseNumber('-.')).toBeNull();
  });

  it('commits the digits typed so far so the sheet previews live', () => {
    expect(parseNumber('1')).toBe(1);
    expect(parseNumber('12.')).toBe(12);
    expect(parseNumber('-.5')).toBe(-0.5);
  });

  it('clamps to the field range', () => {
    expect(parseNumber('0', { min: 1 })).toBe(1);
    expect(parseNumber('99', { min: 1, max: 20 })).toBe(20);
    expect(parseNumber('-8', { min: 0 })).toBe(0);
  });

  it('rejects text that is not numeric at all', () => {
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('1px')).toBeNull();
  });
});

describe('isPartialNumber', () => {
  it('lets a number be typed one character at a time', () => {
    for (const step of ['', '-', '-4', '-40', '-40.', '-40.5']) {
      expect(isPartialNumber(step), step).toBe(true);
    }
  });

  it('blocks characters that could never become a number', () => {
    for (const bad of ['x', '1-', '1.2.3', '--1', '1e']) {
      expect(isPartialNumber(bad), bad).toBe(false);
    }
  });
});

describe('formatNumber', () => {
  it('shows the stored value, not a two-decimal approximation of it', () => {
    expect(formatNumber(249.111)).toBe('249.111');
    expect(formatNumber(163.03125)).toBe('163.03125');
  });

  it('trims float noise', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(320)).toBe('320');
  });

  it('never shows NaN', () => {
    expect(formatNumber(Number.NaN)).toBe('0');
    expect(formatNumber(Infinity)).toBe('0');
  });
});
