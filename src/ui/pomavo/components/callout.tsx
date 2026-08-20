import { cva, type VariantProps } from 'class-variance-authority';
import { Info, TriangleAlert, CircleX, Lightbulb } from 'lucide-react';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '../lib/utils';

/**
 * Callout / notice banner.
 *
 * A dashed-bordered box with a thicker, colored left edge and a filled icon,
 * one visual style per severity. Shared so the docs site and the in-app rich
 * text editor (TipTap) render notices identically.
 */
const calloutVariants = cva(
  'callout my-6 flex gap-3 border border-l-2 border-dashed bg-card p-4 text-sm text-card-foreground shadow-sm',
  {
    variants: {
      variant: {
        info: 'border-l-blue-500',
        warning: 'border-l-amber-500',
        tip: 'border-l-emerald-500',
        danger: 'border-l-red-500',
      },
    },
    defaultVariants: { variant: 'info' },
  }
);

type CalloutVariant = NonNullable<VariantProps<typeof calloutVariants>['variant']>;

/** Accepted aliases mapped onto the four canonical variants. */
const VARIANT_ALIASES: Record<string, CalloutVariant> = {
  info: 'info',
  note: 'info',
  warning: 'warning',
  warn: 'warning',
  tip: 'tip',
  success: 'tip',
  danger: 'danger',
  error: 'danger',
};

const VARIANT_ICON: Record<CalloutVariant, { Icon: typeof Info; fill: string }> = {
  info: { Icon: Info, fill: 'fill-blue-500' },
  warning: { Icon: TriangleAlert, fill: 'fill-amber-500' },
  tip: { Icon: Lightbulb, fill: 'fill-emerald-500' },
  danger: { Icon: CircleX, fill: 'fill-red-500' },
};

type CalloutProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  /** Severity. Preferred prop name across the docs. */
  type?: string;
  /** Backwards-compatible alias for `type`. */
  variant?: string;
  /** Optional bold heading shown above the body. */
  title?: ReactNode;
  /** Override the default icon. */
  icon?: ReactNode;
  children?: ReactNode;
};

export const Callout = forwardRef<HTMLDivElement, CalloutProps>(function Callout(
  { className, type, variant, title, icon, children, ...props },
  ref
) {
  const resolved: CalloutVariant = VARIANT_ALIASES[(type ?? variant ?? 'info').toLowerCase()] ?? 'info';
  const { Icon, fill } = VARIANT_ICON[resolved];

  return (
    <div ref={ref} className={cn(calloutVariants({ variant: resolved }), className)} {...props}>
      {icon ?? <Icon className={cn('mt-0.5 size-5 shrink-0 text-card', fill)} aria-hidden />}
      <div className="callout-content min-w-0 flex-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0">
        {title && <p className="mb-1 font-semibold text-foreground">{title}</p>}
        <div className="text-muted-foreground [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div>
      </div>
    </div>
  );
});

export { calloutVariants };
export type { CalloutProps, CalloutVariant };
