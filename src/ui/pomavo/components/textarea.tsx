import * as React from 'react';

import { cn } from '../lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
}

/* textarea - clean, minimal, matches Input */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <div className="w-full h-full">
        <textarea
          className={cn(
            'w-full h-full min-w-0 border border-transparent bg-transparent px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none',
            'hover:border-foreground/50',
            'focus:border-foreground/50 focus:outline-none',
            'disabled:bg-muted disabled:border-transparent disabled:text-muted-foreground disabled:cursor-not-allowed',
            error && 'border-destructive hover:border-destructive focus:border-destructive',
            className
          )}
          ref={ref}
          {...props}
        />
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
