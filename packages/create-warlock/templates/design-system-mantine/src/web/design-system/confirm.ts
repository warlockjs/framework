import { modals } from "@mantine/modals";
import type { ReactNode } from "react";

export type ConfirmOptions = {
  title?: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Paints the confirm button red, for deletes and other destructive actions. */
  danger?: boolean;
};

/**
 * Ask the visitor to confirm an action. Resolves `true` on confirm and `false`
 * on cancel or when the modal is dismissed. Needs `DesignSystemProvider`.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    modals.openConfirmModal({
      title: options.title ?? "Please confirm",
      children: options.message,
      labels: {
        confirm: options.confirmLabel ?? "Confirm",
        cancel: options.cancelLabel ?? "Cancel",
      },
      confirmProps: options.danger ? { color: "red" } : undefined,
      onConfirm: () => settle(true),
      onCancel: () => settle(false),
      onClose: () => settle(false),
    });
  });
}
