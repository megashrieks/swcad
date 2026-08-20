import * as React from 'react';
import { cn } from '../lib/utils';

interface ProgressProps extends React.HTMLAttributes<HTMLProgressElement> {
  value?: number;
  max?: number;
}

const Progress = React.forwardRef<HTMLProgressElement, ProgressProps>(
  ({ className, value = 0, max = 100, ...props }, ref) => {
    return (
      <progress
        ref={ref}
        value={value}
        max={max}
        className={cn(
          'h-2 w-full overflow-hidden rounded-full bg-secondary',
          '[&::-webkit-progress-bar]:bg-secondary [&::-webkit-progress-bar]:rounded-full',
          '[&::-webkit-progress-value]:bg-primary [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:transition-all [&::-webkit-progress-value]:duration-300',
          '[&::-moz-progress-bar]:bg-primary [&::-moz-progress-bar]:rounded-full',
          className
        )}
        {...props}
      />
    );
  }
);

Progress.displayName = 'Progress';

export { Progress };
