// QuietKeep: KeyringHelpModal.tsx
// Shown when a patch run on an apt-family host fails with a GPG / keyring
// rotation error (NO_PUBKEY, EXPKEYSIG, etc.). QuietKeep deliberately does
// NOT auto-trust new signing keys (that would defeat the purpose of GPG
// verification), so this modal walks the operator through the secure manual
// recovery: fetch the fresh archive keyring over HTTPS, verify, install.
// Author: QuietWire (Dennis Ayotte)

import { useState } from 'react';
import { KeyRound, X, Copy, Check, ExternalLink } from 'lucide-react';

interface KeyringHelpModalProps {
  open: boolean;
  hostname: string;
  ipAddress: string;
  username: string;
  osType: string;
  logExcerpt?: string;
  onClose: () => void;
}

export default function KeyringHelpModal({
  open,
  hostname,
  ipAddress,
  username,
  osType,
  logExcerpt,
  onClose,
}: KeyringHelpModalProps) {
  const [copied, setCopied] = useState(false);
  if (!open) return null;

  // OS-specific recovery. For Kali the current accepted procedure is to
  // download the signed kali-archive-keyring .deb from the official archive
  // over HTTPS (TLS is the trust anchor here, not apt's GPG chain, which is
  // what's broken). Debian/Ubuntu use debian-archive-keyring /
  // ubuntu-keyring which is rotated via apt itself; those are usually
  // resolved by `apt-get install --reinstall`.
  const kaliCommands = `# Run these on ${hostname} (${ipAddress}) as ${username}
# 1. Check https://www.kali.org/blog/ for the LATEST keyring version.
#    Replace the filename below with the current one before running.
wget https://http.kali.org/pool/main/k/kali-archive-keyring/kali-archive-keyring_2024.1_all.deb

# 2. Verify the sha256 against the value published in the Kali announcement.
sha256sum kali-archive-keyring_*.deb

# 3. Install the refreshed keyring.
sudo dpkg -i kali-archive-keyring_*.deb

# 4. Retry apt. Should succeed now.
sudo apt-get update`;

  const debianCommands = `# Run these on ${hostname} (${ipAddress}) as ${username}
# Debian/Ubuntu rotate via their own keyring package. Reinstall it from the
# currently-cached (still trusted) copy, then refresh the index.
sudo apt-get install --reinstall debian-archive-keyring ubuntu-keyring 2>/dev/null || \\
  sudo apt-get install --reinstall debian-archive-keyring

sudo apt-get update`;

  const commands = osType === 'kali' ? kaliCommands : debianCommands;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(commands);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. non-HTTPS context). User can still
      // select and copy manually from the <pre> block.
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-amber-500/30 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-amber-400" />
            <h2 className="text-base font-semibold text-gray-100">
              Repository Signing Key Rotated
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-sm text-gray-300 space-y-2">
            <p>
              The patch on{' '}
              <span className="font-medium text-white">{hostname}</span> failed
              because the distribution rotated its repository signing key.
              QuietKeep will <span className="text-amber-400 font-medium">not</span>{' '}
              auto-trust the new key. That would bypass the GPG chain that
              package integrity depends on.
            </p>
            <p className="text-gray-400 text-xs">
              Run the steps below on the host to install the refreshed keyring
              over an authenticated HTTPS channel, then try patching again from
              QuietKeep.
            </p>
          </div>

          {logExcerpt && (
            <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-3">
              <p className="text-xs text-red-300 mb-1 font-semibold uppercase tracking-wide">
                Error from host
              </p>
              <pre className="text-xs text-red-200 font-mono whitespace-pre-wrap break-all">
                {logExcerpt}
              </pre>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Manual recovery
              </p>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </button>
            </div>
            <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs text-gray-300 font-mono whitespace-pre overflow-x-auto">
              {commands}
            </pre>
          </div>

          {osType === 'kali' && (
            <a
              href="https://www.kali.org/blog/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Kali blog: latest key rotation announcement
            </a>
          )}

          <div className="pt-2 border-t border-gray-800 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-sm transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
