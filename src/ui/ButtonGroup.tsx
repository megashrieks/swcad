import type { ReactNode } from 'react';

/**
 * Segmented cluster of related buttons: the members share their borders so the cluster
 * reads as one control. Non-button children (a readout such as the zoom percentage) join
 * the strip as a plain segment.
 */
export function ButtonGroup({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={`btn-group${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
      {children}
    </div>
  );
}
