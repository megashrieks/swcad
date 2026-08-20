import { useState, type KeyboardEvent } from 'react';
import { Input, cn } from './pomavo';

/**
 * Numeric field that survives hand editing. A controlled `<input type="number">` fights the
 * typist: half-typed text such as `-` or `12.` reads back as an empty value, so every
 * keystroke used to commit a wrong number (clearing the box moved a node to 0, and a leading
 * minus was swallowed). This keeps the raw text while the field is focused, commits only the
 * states that are already a number — so the sheet still previews live — and shows the stored
 * value at full precision, not rounded to two decimals.
 */
export function NumberInput({
  value,
  onCommit,
  min,
  max,
  step = 1,
  precision = 6,
  disabled,
  className = 'input',
  title,
  placeholder,
}: {
  /** `null` when the field stands for several values that disagree: the box shows blank. */
  value: number | null;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  disabled?: boolean;
  className?: string;
  title?: string;
  placeholder?: string;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? '' : formatNumber(value, precision));

  const clamp = (n: number): number => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));

  const type = (text: string): void => {
    if (!isPartialNumber(text)) return;
    setDraft(text);
    const next = parseNumber(text, { min, max });
    if (next !== null) onCommit(next);
  };

  const nudge = (by: number): void => {
    const base = draft !== null ? Number(draft) : (value ?? 0);
    const next = clamp((Number.isFinite(base) ? base : 0) + by);
    setDraft(null);
    onCommit(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const jump = step * (event.shiftKey ? 10 : 1);
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      nudge(jump);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      nudge(-jump);
    } else if (event.key === 'Enter' || event.key === 'Escape') {
      setDraft(null);
    }
  };

  return (
    <Input
      className={cn(className)}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      title={title}
      placeholder={placeholder}
      value={shown}
      onChange={(e) => type(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => setDraft(null)}
    />
  );
}

/** Text on its way to a number: `-`, `12.`, `-.5` are all legal mid-typing states. */
const PARTIAL = /^-?(\d+\.?\d*|\.\d*)?$/;

/** Would this text still be a number if the user kept typing? */
export function isPartialNumber(text: string): boolean {
  return PARTIAL.test(text);
}

/**
 * The number this text already is, clamped, or `null` while it is only on the way to one
 * (`''`, `-`, `.`, `-.`). Returning `null` is what stops an emptied field from committing 0.
 */
export function parseNumber(text: string, range: { min?: number; max?: number } = {}): number | null {
  if (!isPartialNumber(text) || /^-?\.?$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return Math.min(range.max ?? Infinity, Math.max(range.min ?? -Infinity, n));
}

/** Full precision without float noise: 249.111 stays 249.111, 0.1 + 0.2 reads as 0.3. */
export function formatNumber(value: number, precision = 6): string {
  if (!Number.isFinite(value)) return '0';
  return String(Number(value.toFixed(precision)));
}
