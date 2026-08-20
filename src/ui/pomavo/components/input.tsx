import * as React from 'react';

import { cn } from '../lib/utils';

interface InputProps extends React.ComponentProps<'input'> {
  error?: string;
}

/* input - clean, minimal */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => {
    return (
      <div className="w-full">
        <input
          ref={ref}
          type={type}
          data-slot="input"
          aria-invalid={Boolean(error)}
          className={cn(
            'h-8 w-full min-w-0 border border-transparent bg-transparent px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground outline-none',
            'hover:border-foreground/50',
            'focus:border-foreground/50 focus:outline-none',
            'disabled:bg-muted disabled:border-transparent disabled:text-muted-foreground disabled:cursor-not-allowed',
            'aria-invalid:border-destructive aria-invalid:hover:border-destructive aria-invalid:focus:border-destructive',
            'file:border-0 file:bg-transparent file:text-sm file:font-normal',
            'dark:[color-scheme:dark]',
            className
          )}
          {...props}
        />
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';

export { Input };
