import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';

import { cn } from '../lib/utils';

/* label - compact, lighter weight */
function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'text-xs font-normal text-muted-foreground select-none leading-none',
        'peer-disabled:text-muted-foreground peer-disabled:cursor-not-allowed',
        className
      )}
      {...props}
    />
  );
}

export { Label };
