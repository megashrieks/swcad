import * as React from 'react';
import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  readonly id: string;
  readonly type: ToastType;
  readonly title: string;
  readonly description?: string;
}

type ToastOptions = Omit<Toast, 'id'>;

// Event-based toast system for use outside React components
type ToastListener = (options: ToastOptions) => void;
const toastListeners = new Set<ToastListener>();

/**
 * Show a toast notification. Can be called from anywhere, including outside React components.
 */
export function toast(options: ToastOptions): void {
  if (toastListeners.size === 0) {
    console.warn('Toast called before ToastProvider mounted:', options);
    return;
  }
  toastListeners.forEach((listener) => listener(options));
}

interface ToastContextValue {
  toasts: Toast[];
  toast: (options: ToastOptions) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export function ToastProvider({ children }: { readonly children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((toastId: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== toastId));
  }, []);

  const scheduleAutoDismiss = useCallback(
    (id: string) => {
      setTimeout(() => dismissToast(id), 10000);
    },
    [dismissToast]
  );

  const showToast = useCallback(
    (options: ToastOptions) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { ...options, id }]);

      // Auto dismiss after 10 seconds
      scheduleAutoDismiss(id);
    },
    [scheduleAutoDismiss]
  );

  // Subscribe to global toast events
  useEffect(() => {
    toastListeners.add(showToast);
    return () => {
      toastListeners.delete(showToast);
    };
  }, [showToast]);

  const dismiss = useCallback((id: string) => {
    dismissToast(id);
  }, []);

  // Memoize context value to prevent unnecessary re-renders of consumers
  const contextValue = useMemo(
    () => ({
      toasts,
      toast: showToast,
      dismiss,
    }),
    [toasts, showToast, dismiss]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const iconMap: Record<Toast['type'], typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const iconColorMap = {
  success: 'text-primary',
  error: 'text-destructive',
  warning: 'text-[var(--warning)]',
  info: 'text-primary',
};

function ToastContainer({
  toasts,
  onDismiss,
}: {
  readonly toasts: Toast[];
  readonly onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-8 right-8 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => {
        const Icon = iconMap[toast.type];
        return (
          <div
            key={toast.id}
            className="flex items-start gap-3 px-4 py-3 bg-card shadow-[0_2px_8px_rgba(0,0,0,0.12)] dark:border dark:border-border animate-in slide-in-from-right-full duration-200"
          >
            <Icon className={cn('h-4 w-4 shrink-0 mt-0.5', iconColorMap[toast.type])} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground leading-tight">{toast.title}</p>
              {toast.description && (
                <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
                  {toast.description}
                </p>
              )}
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
