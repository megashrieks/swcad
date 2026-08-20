/**
 * The three form controls the panels use, wrapped so a call site stays one element.
 *
 * They are Pomavo's `Input`, `Checkbox` and `Select` underneath — borderless at rest, a
 * hairline on hover and focus — with swcad's old `.input` / `.check` class names kept as
 * layout hooks so the surrounding grid rules in `theme.css` still apply.
 */
import { useState, type ReactNode } from 'react';
import { PALETTE_TOKENS, themeColorId, themeColorRef } from '@core/theme/palette';
import {
  Checkbox,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from './pomavo';

export interface Option {
  readonly value: string;
  readonly label: string;
}

export function TextField({
  value,
  onChange,
  placeholder,
  type = 'text',
  className,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
  disabled?: boolean;
  spellCheck?: boolean;
}): JSX.Element {
  return (
    <Input
      className={cn('input', className)}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    />
  );
}

/**
 * A colour well that can hold either a fixed colour or a borrowed one.
 *
 * A fixed value (`#2e3440`) is stored verbatim and never moves. A theme value is stored
 * as `var(--sw-accent)`, which the browser resolves against the active palette — so the
 * shape follows the theme, and the exporter bakes in whatever it resolved to. The text
 * box shows the short token name (`accent`) and accepts one too.
 */
export function ColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  const tokenId = themeColorId(value);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? tokenId ?? value;

  const commit = (text: string): void => {
    setDraft(null);
    const trimmed = text.trim();
    const match = PALETTE_TOKENS.find((t) => t.id === trimmed.replace(/^--sw-/, ''));
    onChange(match ? themeColorRef(match.id) : trimmed);
  };

  return (
    <div className="input color-field">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="color-swatch"
            style={{ background: value }}
            aria-label={tokenId ? `Colour: ${tokenId} (theme)` : `Colour: ${value}`}
          />
        </PopoverTrigger>
        <PopoverContent align="start" className="color-pop">
          <p className="color-pop-head">Theme</p>
          <div className="color-pop-grid">
            {PALETTE_TOKENS.map((t) => (
              <button
                key={t.id}
                type="button"
                title={`${t.label} — ${t.hint}`}
                aria-label={t.label}
                data-active={t.id === tokenId ? 'true' : undefined}
                className="color-chip"
                style={{ background: themeColorRef(t.id) }}
                onClick={() => {
                  setDraft(null);
                  onChange(themeColorRef(t.id));
                }}
              />
            ))}
          </div>
          <p className="color-pop-head">Fixed</p>
          <input
            type="color"
            className="color-pop-native"
            value={tokenId ? '#000000' : normalizeHex(value)}
            onChange={(e) => {
              setDraft(null);
              onChange(e.target.value);
            }}
          />
        </PopoverContent>
      </Popover>
      <Input
        className="color-hex"
        type="text"
        value={shown}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    </div>
  );
}

/** `<input type="color">` only accepts `#rrggbb`; anything else would reset it to black. */
function normalizeHex(value: string): string {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return '#000000';
}

export function CheckField({
  checked,
  onChange,
  children,
  className,
}: {
  /** `'indeterminate'` when the box stands for several values that disagree. */
  checked: boolean | 'indeterminate';
  onChange: (checked: boolean) => void;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <Label className={cn('check', className)}>
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <span>{children}</span>
    </Label>
  );
}

export function SelectField({
  value,
  onChange,
  options,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly Option[];
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}): JSX.Element {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className={cn('input', className)} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
