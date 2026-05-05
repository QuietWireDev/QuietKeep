// QuietKeep: FixSudoersModal.tsx
// Password-prompt modal for installing /etc/sudoers.d/quietkeep-<user> on a
// remote host. Styling follows ConfirmDialog (centered, backdrop-blur, dark
// card) so users encounter a consistent modal language. The password is sent
// once to the backend, used for a single SSH session, and never stored.
// Author: QuietWire (Dennis Ayotte)

import { useState, useEffect, useRef } from 'react';
import { KeyRound, Loader2, AlertTriangle } from 'lucide-react';

interface FixSudoersModalProps {
  open: boolean;
  hostname: string;
  username: string;
  osType: string;
  onCancel: () => void;
  onConfirm: (password: string) => Promise<void>;
}

export default function FixSudoersModal({
  open,
  hostname,
  username,
  osType,
  onCancel,
  onConfirm,
}: FixSudoersModalProps) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state on open and focus the password field so the modal is
  // keyboard-first. Mirrors the UX of a shell sudo prompt.
  useEffect(() => {
    if (open) {
      setPassword('');
      setError(null);
      setLoading(false);
      // Delay focus until the modal is mounted.
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const pacman = osType === 'pacman';
  const sudoCmds = pacman
    ? '/usr/bin/pacman *, /usr/sbin/reboot'
    : '/usr/bin/apt *, /usr/bin/apt-get *, /usr/sbin/reboot';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      setError('Password is required.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onConfirm(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install sudoers');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-gray-900 border border-emerald-800/50 rounded-xl w-full max-w-lg p-6 space-y-5"
      >
        <div className="flex items-start gap-4">
          <KeyRound className="h-8 w-8 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-emerald-400">Fix Sudoers on {hostname}</h3>
            <div className="text-sm text-gray-400 mt-2 break-words space-y-3">
              <p>
                Enter the SSH password for <span className="font-mono text-gray-200">{username}@{hostname}</span>.
                It will be used once to install the sudoers rule and then discarded.
              </p>
              <div className="bg-gray-950/60 border border-gray-800 rounded-md p-3 text-xs text-gray-400">
                <div className="text-gray-300 font-medium mb-1">Rule to be installed</div>
                <div className="font-mono text-gray-400 break-all">
                  {username} ALL=(ALL) NOPASSWD: {sudoCmds}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">SSH Password</label>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            autoComplete="current-password"
            className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-emerald-500/60 focus:border-emerald-500/60 disabled:opacity-50"
            placeholder="Password"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-red-950/40 border border-red-800/60 rounded-md p-3 text-sm text-red-300">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm font-medium transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !password}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Install Sudoers
          </button>
        </div>
      </form>
    </div>
  );
}
