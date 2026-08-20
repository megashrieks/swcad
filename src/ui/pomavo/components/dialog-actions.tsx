import type { ReactNode } from 'react';
import { DialogFooter } from './dialog';
import { Button } from './button';
import { Spinner } from './spinner';

export interface DialogActionsProps {
  /**
   * Label for the primary/confirm button. Defaults to "Save".
   */
  readonly confirmLabel?: string;
  /**
   * Label for the cancel button. Defaults to "Cancel".
   */
  readonly cancelLabel?: string;
  /**
   * Click handler for the confirm button. If omitted, the button is rendered
   * as a `submit` button inside a parent `<form>`.
   */
  readonly onConfirm?: () => void;
  /**
   * Click handler for the cancel button.
   */
  readonly onCancel?: () => void;
  /**
   * Disables the confirm button. Automatically disabled while `loading`.
   */
  readonly disabled?: boolean;
  /**
   * Shows a spinner next to the confirm label and disables both buttons.
   */
  readonly loading?: boolean;
  /**
   * Variant of the confirm button. Use `'destructive'` for delete confirmations.
   */
  readonly confirmVariant?: 'default' | 'destructive' | 'outline' | 'ghost';
  /**
   * Extra content rendered before the Cancel button (e.g. a secondary action).
   */
  readonly extra?: ReactNode;
}

/**
 * Standard Cancel + Confirm dialog footer.
 *
 * Replaces the 15+ ad-hoc `<DialogFooter><Button>Cancel</Button><Button>Save</Button></DialogFooter>`
 * blocks scattered across the app. Handles the common "loading → disabled + spinner"
 * state and the "destructive confirm" variant.
 */
export function DialogActions({
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  disabled,
  loading,
  confirmVariant = 'default',
  extra,
}: DialogActionsProps) {
  const isDisabled = disabled || loading;
  return (
    <DialogFooter>
      {extra}
      <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
        {cancelLabel}
      </Button>
      <Button
        type={onConfirm ? 'button' : 'submit'}
        variant={confirmVariant}
        onClick={onConfirm}
        disabled={isDisabled}
      >
        {loading && <Spinner className="h-4 w-4" />}
        {confirmLabel}
      </Button>
    </DialogFooter>
  );
}
