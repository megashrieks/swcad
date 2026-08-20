import { Loader2Icon } from 'lucide-react';

import { cn } from '../lib/utils';

/* spinner */
function Spinner({ className, ...props }: Readonly<React.ComponentProps<'svg'>>) {
  return (
    <output className="inline-flex" aria-label="Loading">
      <Loader2Icon
        aria-hidden="true"
        className={cn('size-4 animate-spin text-primary', className)}
        {...props}
      />
    </output>
  );
}

export { Spinner };
