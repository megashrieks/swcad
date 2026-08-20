import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/utils';

/* badge - less rounded, flat colors */
const badgeVariants = cva(
  'inline-flex items-center justify-center px-2 py-0.5 text-xs font-semibold w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-secondary-foreground border border-border',
        destructive: 'bg-destructive text-destructive-foreground',
        outline: 'bg-transparent text-foreground border border-input',
        success: 'bg-[var(--success)] text-[var(--success-foreground)]',
        warning: 'bg-[var(--warning)] text-[var(--warning-foreground)]',
        info: 'bg-primary/10 text-primary',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span';

  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
