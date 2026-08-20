import {
  useCallback,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Button,
  Dialog as PomavoDialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from './pomavo';

/**
 * Modal dialogs, in the app's own skin.
 *
 * `window.alert`, `window.confirm` and `window.prompt` are the browser's, not ours: they
 * look like the browser chrome rather than the editor, they cannot say which button is the
 * dangerous one, and they freeze the whole page — including the file watcher and the render
 * loop — until they are answered. So this module owns the three of them.
 *
 * Two layers, because they are wanted for different things:
 *
 * - `Dialog` is the plain component — a backdrop, a panel, whatever body and buttons you
 *   give it. It is Pomavo's Radix-backed dialog underneath, so the portal, focus trap,
 *   focus restore, Escape and backdrop dismissal all come for free.
 * - `showAlert` / `showConfirm` / `showPrompt` are the drop-in replacements for the three
 *   window functions. They return promises, queue if one is already open, and render
 *   through `<DialogHost />`, which is mounted once next to the app.
 */

export type DialogTone = 'default' | 'danger';

/** A modal panel. Render it when it should be on screen; unmount it to close. */
export function Dialog({
  title,
  children,
  actions,
  onDismiss,
  size = 'md',
  className = '',
}: {
  /** Heading; omitted when the message says everything. */
  title?: string;
  /** The body. Mark the element that should take focus with `data-autofocus`. */
  children?: ReactNode;
  /** The buttons, in reading order — the last one is the rightmost. */
  actions?: ReactNode;
  /** Escape, the backdrop and the close affordance all mean this. */
  onDismiss: () => void;
  /** How wide the panel is allowed to get. A question needs `md`; a browser needs `xl`. */
  size?: 'sm' | 'md' | 'default' | 'lg' | 'xl' | 'full';
  className?: string;
}): JSX.Element {
  return (
    <PomavoDialog
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent
        size={size}
        showCloseButton={false}
        className={`dialog${className ? ` ${className}` : ''}`}
        aria-label={title ?? 'Dialog'}
        onOpenAutoFocus={(event) => {
          // Radix focuses the panel; prefer whatever the body nominated.
          const panel = event.currentTarget;
          if (!(panel instanceof HTMLElement)) return;
          const wanted = panel.querySelector<HTMLElement>('[data-autofocus]');
          if (!wanted) return;
          event.preventDefault();
          wanted.focus();
        }}
      >
        <DialogHeader className={title ? undefined : 'sr-only'}>
          <DialogTitle className="dialog-title">{title ?? 'Dialog'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="dialog-body">{children}</DialogBody>
        {actions ? <DialogFooter className="dialog-actions">{actions}</DialogFooter> : null}
      </DialogContent>
    </PomavoDialog>
  );
}

/* --------------------------------------------------------------- the three window functions */

export interface AlertOptions {
  title?: string;
  confirmLabel?: string;
}

export interface ConfirmOptions extends AlertOptions {
  cancelLabel?: string;
  /** `danger` paints the confirming button red: deleting, discarding, overwriting. */
  tone?: DialogTone;
}

export interface PromptOptions extends ConfirmOptions {
  /** What the field starts with, and what pressing the button returns if left alone. */
  value?: string;
  placeholder?: string;
}

export interface DialogRequest {
  readonly id: number;
  readonly kind: 'alert' | 'confirm' | 'prompt';
  readonly title: string | undefined;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string | null;
  readonly tone: DialogTone;
  readonly value: string;
  readonly placeholder: string;
}

/** What a dialog hands back: nothing, a yes/no, or the text typed (null when dismissed). */
export type DialogAnswer = void | boolean | string | null;

interface Entry {
  /** What to show. */
  readonly request: DialogRequest;
  /** Resolve the promise the caller is waiting on. */
  readonly settle: (answer: DialogAnswer) => void;
}
export type { Entry as PendingDialog };

let entries: readonly Entry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function publish(next: readonly Entry[]): void {
  entries = next;
  for (const listener of [...listeners]) listener();
}

function ask<T extends DialogAnswer>(request: Omit<DialogRequest, 'id'>): Promise<T> {
  return new Promise<T>((resolve) => {
    const entry: Entry = {
      request: { ...request, id: (nextId += 1) },
      settle: (answer) => resolve(answer as T),
    };
    // One at a time, in the order they were asked: a second question stacked on top of the
    // first would hide it, and answering it would look like an answer to the wrong one.
    publish([...entries, entry]);
  });
}

/** Every dialog waiting to be answered; the first is the one on screen. */
export function pendingDialogs(): readonly Entry[] {
  return entries;
}

/** Answer the dialog with this id, closing it and letting the next one through. */
export function answerDialog(id: number, answer: DialogAnswer): void {
  const entry = entries.find((e) => e.request.id === id);
  if (!entry) return;
  publish(entries.filter((e) => e !== entry));
  entry.settle(answer);
}

export function subscribeDialogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What dismissing a dialog — Escape, the backdrop, Cancel — means for each kind. */
export function dismissedAnswer(kind: DialogRequest['kind']): DialogAnswer {
  if (kind === 'confirm') return false;
  if (kind === 'prompt') return null;
  return undefined;
}

/** Say something, with one button to acknowledge it. Replaces `window.alert`. */
export function showAlert(message: string, options: AlertOptions = {}): Promise<void> {
  return ask<void>({
    kind: 'alert',
    title: options.title,
    message,
    confirmLabel: options.confirmLabel ?? 'OK',
    cancelLabel: null,
    tone: 'default',
    value: '',
    placeholder: '',
  });
}

/** Ask a yes/no question. Resolves false when dismissed. Replaces `window.confirm`. */
export function showConfirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  return ask<boolean>({
    kind: 'confirm',
    title: options.title,
    message,
    confirmLabel: options.confirmLabel ?? 'OK',
    cancelLabel: options.cancelLabel ?? 'Cancel',
    tone: options.tone ?? 'default',
    value: '',
    placeholder: '',
  });
}

/** Ask for a line of text. Resolves null when dismissed. Replaces `window.prompt`. */
export function showPrompt(message: string, options: PromptOptions = {}): Promise<string | null> {
  return ask<string | null>({
    kind: 'prompt',
    title: options.title,
    message,
    confirmLabel: options.confirmLabel ?? 'OK',
    cancelLabel: options.cancelLabel ?? 'Cancel',
    tone: options.tone ?? 'default',
    value: options.value ?? '',
    placeholder: options.placeholder ?? '',
  });
}

/** Mount once, alongside the app: this is where the queued dialogs appear. */
export function DialogHost(): JSX.Element | null {
  const queue = useSyncExternalStore(subscribeDialogs, pendingDialogs, pendingDialogs);
  const current = queue[0]?.request ?? null;
  return current ? <QueuedDialog key={current.id} request={current} /> : null;
}

function QueuedDialog({ request }: { request: DialogRequest }): JSX.Element {
  const [text, setText] = useState(request.value);
  const answer = useCallback(
    (value: DialogAnswer) => answerDialog(request.id, value),
    [request.id],
  );
  const dismiss = useCallback(() => answer(dismissedAnswer(request.kind)), [answer, request.kind]);

  const confirm = (event?: FormEvent): void => {
    event?.preventDefault();
    answer(request.kind === 'prompt' ? text : request.kind === 'confirm' ? true : undefined);
  };

  const buttons = (
    <>
      {request.cancelLabel ? (
        <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
          {request.cancelLabel}
        </Button>
      ) : null}
      <Button
        type={request.kind === 'prompt' ? 'submit' : 'button'}
        variant={request.tone === 'danger' ? 'destructive' : 'default'}
        size="sm"
        onClick={request.kind === 'prompt' ? undefined : () => confirm()}
        // A question with a text field belongs to the field; anything else to its answer.
        data-autofocus={request.kind === 'prompt' ? undefined : true}
      >
        {request.confirmLabel}
      </Button>
    </>
  );

  const message = request.message.split('\n\n').map((para, i) => (
    // eslint-disable-next-line react/no-array-index-key
    <DialogDescription key={i} className="dialog-message">
      {para}
    </DialogDescription>
  ));

  if (request.kind !== 'prompt') {
    return (
      <Dialog title={request.title} actions={buttons} onDismiss={dismiss}>
        {message}
      </Dialog>
    );
  }
  // Wrapped in a form so Enter in the field means the same as clicking the button.
  return (
    <Dialog title={request.title} onDismiss={dismiss} className="dialog-prompt">
      <form onSubmit={confirm} className="flex flex-col gap-3">
        {message}
        <Input
          value={text}
          placeholder={request.placeholder}
          spellCheck={false}
          autoComplete="off"
          data-autofocus
          onChange={(e) => setText(e.target.value)}
        />
        <div className="dialog-actions flex items-center justify-end gap-2 pt-1">{buttons}</div>
      </form>
    </Dialog>
  );
}
