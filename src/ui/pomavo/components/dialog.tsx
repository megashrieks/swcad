import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';

import { cn } from '../lib/utils';

/* dialog - flat, minimal decoration */
type DialogProps = Readonly<React.ComponentProps<typeof DialogPrimitive.Root>>;

function Dialog({ ...props }: DialogProps) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

type DialogTriggerProps = Readonly<React.ComponentProps<typeof DialogPrimitive.Trigger>>;

function DialogTrigger({ ...props }: DialogTriggerProps) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: Readonly<React.ComponentProps<typeof DialogPrimitive.Portal>>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: Readonly<React.ComponentProps<typeof DialogPrimitive.Close>>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className
      )}
      {...props}
    />
  );
}

const dialogSizeClasses = {
  sm: 'max-w-[calc(100%-2rem)] sm:max-w-sm max-h-[calc(100vh-4rem)]',
  md: 'max-w-[calc(100%-2rem)] sm:max-w-md max-h-[calc(100vh-4rem)]',
  default: 'max-w-[calc(100%-2rem)] sm:max-w-lg max-h-[calc(100vh-4rem)]',
  lg: 'max-w-[calc(100%-2rem)] sm:max-w-2xl max-h-[calc(100vh-3rem)]',
  xl: 'max-w-[calc(100%-2rem)] sm:max-w-4xl max-h-[calc(100vh-2rem)]',
  full: 'max-w-[calc(100%-2rem)] sm:max-w-[90vw] max-h-[calc(100vh-2rem)]',
} as const;

type DialogSize = keyof typeof dialogSizeClasses;

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = 'default',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  size?: DialogSize;
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay className="flex items-center justify-center">
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            'relative z-50 grid w-full overflow-y-auto bg-background border border-border rounded-md shadow-lg outline-none',
            dialogSizeClasses[size],
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            className
          )}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              className="absolute top-3 right-3 p-1 text-muted-foreground hover:text-foreground hover:bg-accent outline-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogOverlay>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1 px-6 pt-5', className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex items-center justify-end gap-2 px-6 pb-5 pt-2', className)}
      {...props}
    />
  );
}

function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-body" className={cn('px-6 py-4', className)} {...props} />;
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg font-semibold text-foreground', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
