// QuietKeep: ConfirmDialog.tsx
// Reusable centered confirmation modal. Replaces native window.confirm() calls
// which render at the top of the viewport and are easy to miss on tall monitors
// (see BUG-003). Modeled on the Delete All Hosts modal pattern in
// HostManagement.tsx: fixed overlay with backdrop blur, centered card,
// AlertTriangle icon, Cancel and Confirm buttons with loading state.
// Author: QuietWire (Dennis Ayotte)

import { AlertTriangle, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

export type ConfirmVariant = 'danger' | 'warning' | 'primary';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Variant styling. Keeps each severity visually distinct so the user reads the
// modal before clicking through. Icon color, title color, and confirm button
// color all follow the variant. Border stays subtle for all variants.
const VARIANT_STYLES: Record<ConfirmVariant, { border: string; icon: string; title: string; button: string }> = {
  danger: {
    border: 'border-red-800/50',
    icon: 'text-red-400',
    title: 'text-red-400',
    button: 'bg-red-700 hover:bg-red-600',
  },
  warning: {
    border: 'border-amber-800/50',
    icon: 'text-amber-400',
    title: 'text-amber-400',
    button: 'bg-amber-600 hover:bg-amber-500',
  },
  primary: {
    border: 'border-emerald-800/50',
    icon: 'text-emerald-400',
    title: 'text-emerald-400',
    button: 'bg-emerald-600 hover:bg-emerald-500',
  },
};

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  const styles = VARIANT_STYLES[variant];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className={`bg-gray-900 border ${styles.border} rounded-xl w-full max-w-md p-6 space-y-5`}>
        <div className="flex items-start gap-4">
          <AlertTriangle className={`h-8 w-8 ${styles.icon} flex-shrink-0 mt-0.5`} />
          <div className="min-w-0">
            <h3 className={`text-lg font-semibold ${styles.title}`}>{title}</h3>
            <div className="text-sm text-gray-400 mt-2 break-words">{message}</div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${styles.button} text-sm font-medium transition-colors disabled:opacity-50`}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
