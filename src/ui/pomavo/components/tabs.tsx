import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '../lib/utils';
import { Button } from './button';

type TabsVariant = 'pill' | 'underline';

const TabsVariantContext = React.createContext<TabsVariant>('pill');

/**
 * Radix-backed tabs. Two visual variants:
 *  - `pill` (default): ghost-bordered Button pills.
 *  - `underline`: minimal underlined triggers (docs / Better Auth style).
 */
function Tabs({
  className,
  variant = 'pill',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & { variant?: TabsVariant }) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col', className)} {...props} />
    </TabsVariantContext.Provider>
  );
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  const variant = React.useContext(TabsVariantContext);
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        variant === 'underline'
          ? 'flex items-center gap-4 border-b border-border'
          : 'inline-flex items-center gap-2',
        className
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  children,
  value,
  disabled,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(TabsVariantContext);

  if (variant === 'underline') {
    return (
      <TabsPrimitive.Trigger
        data-slot="tabs-trigger"
        value={value}
        disabled={disabled}
        className={cn(
          'inline-flex items-center whitespace-nowrap border-b-2 border-transparent py-1.5 text-sm leading-none text-muted-foreground transition-colors first:ml-3 hover:text-foreground',
          'data-[state=active]:border-foreground data-[state=active]:text-foreground',
          "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className
        )}
        {...props}
      >
        {children}
      </TabsPrimitive.Trigger>
    );
  }

  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      value={value}
      disabled={disabled}
      asChild
      {...props}
    >
      <Button
        variant="outline"
        size="sm"
        className={cn(
          'font-normal text-sm',
          'data-[state=active]:bg-primary/15 data-[state=active]:text-primary data-[state=active]:border-primary',
          "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className
        )}
      >
        {children}
      </Button>
    </TabsPrimitive.Trigger>
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 pt-4 outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
