import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/utils';

/* buttons - flat, minimal radius, clear hierarchy */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold disabled:pointer-events-none disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 disabled:bg-muted disabled:text-muted-foreground',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80 disabled:bg-muted disabled:text-muted-foreground',
        'destructive-secondary':
          'bg-destructive/10 text-destructive hover:bg-destructive/15 active:bg-destructive/20 disabled:bg-muted disabled:text-muted-foreground',
        outline:
          'border border-input bg-background text-foreground hover:bg-primary/10 hover:text-primary hover:border-primary active:bg-primary/15 disabled:bg-muted disabled:text-muted-foreground disabled:border-border',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70 disabled:bg-muted disabled:text-muted-foreground',
        ghost:
          'bg-transparent text-foreground hover:bg-primary/10 hover:text-primary active:bg-primary/15 disabled:text-muted-foreground',
        'ghost-bordered':
          'bg-transparent text-foreground border border-transparent hover:border-primary hover:text-primary hover:bg-primary/10 focus:border-primary focus:text-primary focus:bg-primary/10 active:bg-primary/15 disabled:text-muted-foreground data-[active=true]:bg-primary/15 data-[active=true]:text-primary data-[active=true]:border-primary',
        link: 'bg-transparent text-primary font-normal hover:underline disabled:text-muted-foreground disabled:no-underline p-0 h-auto',
      },
      size: {
        default: 'h-8 px-4 py-1',
        sm: 'h-7 px-3 text-xs',
        lg: 'h-9 px-5',
        icon: 'size-8',
        'icon-sm': 'size-7',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
