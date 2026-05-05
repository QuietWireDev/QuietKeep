// QuietKeep: SettingsPage.tsx
// Multi-section settings panel with sidebar navigation. Sections: General (theme),
// SSH (key upload, public key display, deploy-to-hosts), Scanning (intervals),
// Hosts (delegates to HostManagement), About. Settings auto-save on change/blur
// with a brief "Saved" indicator. SSH key deployment uses one-time password auth.
// Author: QuietWire (Dennis Ayotte)

import { useState, useRef, useEffect } from 'react';
import { Sun, Moon, Monitor, Key, Clock, Server, Info, Check, Loader2, Copy, ChevronDown, ChevronUp, X, ShieldCheck, Upload, Lock } from 'lucide-react';
import type { AppSettings, AppSettingsUpdate, Host } from '../types';
import { useSettings, updateSettings, useHosts } from '../hooks/useApi';
import { applyTheme } from '../hooks/useTheme';
import HostManagement from './HostManagement';

type Section = 'general' | 'security' | 'ssh' | 'scanning' | 'hosts' | 'about';

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Monitor className="h-4 w-4" /> },
  { id: 'security', label: 'Security', icon: <Lock className="h-4 w-4" /> },
  { id: 'ssh', label: 'SSH', icon: <Key className="h-4 w-4" /> },
  { id: 'scanning', label: 'Scanning', icon: <Clock className="h-4 w-4" /> },
  { id: 'hosts', label: 'Hosts', icon: <Server className="h-4 w-4" /> },
  { id: 'about', label: 'About', icon: <Info className="h-4 w-4" /> },
];

function SaveIndicator({ saving, saved }: { saving: boolean; saved: boolean }) {
  if (saving) return <span className="flex items-center gap-1 text-xs text-gray-400"><Loader2 className="h-3 w-3 animate-spin" /> Saving...</span>;
  if (saved) return <span className="flex items-center gap-1 text-xs text-emerald-400"><Check className="h-3 w-3" /> Saved</span>;
  return null;
}

function SSHPublicKeyDisplay({ refreshKey }: { refreshKey?: number }) {
  const [pubKey, setPubKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setPubKey(null);
    setError(null);
    fetch('/api/settings/ssh-public-key')
      .then(res => {
        if (!res.ok) throw new Error('Public key not found');
        return res.json();
      })
      .then(data => setPubKey(data.public_key))
      .catch(err => setError(err.message));
  }, [refreshKey]);

  function copyKey() {
    if (!pubKey) return;
    try {
      // Clipboard API requires secure context (HTTPS or localhost).
      // Falls back to execCommand for plain HTTP deployments.
      navigator.clipboard.writeText(pubKey).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => fallbackCopy());
    } catch {
      fallbackCopy();
    }

    function fallbackCopy() {
      const textarea = document.createElement('textarea');
      textarea.value = pubKey!;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (error) return (
    <div className="text-xs text-gray-500">
      Public key not available. Generate one first (see setup guide below).
    </div>
  );

  if (!pubKey) return null;

  return (
    <div>
      <label className="block text-sm font-medium mb-1">Public Key</label>
      <div className="flex gap-2">
        <code className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs font-mono break-all select-all">
          {pubKey}
        </code>
        <button
          onClick={copyKey}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 transition-colors text-xs font-medium"
          title="Copy public key"
        >
          {copied
            ? <><Check className="h-4 w-4 text-emerald-400" /><span className="text-emerald-400">Copied!</span></>
            : <><Copy className="h-4 w-4 text-gray-400" /><span className="text-gray-400">Copy</span></>}
        </button>
      </div>
      <p className="text-xs text-gray-500 mt-1">Add this key to <code>~/.ssh/authorized_keys</code> on each managed host.</p>
    </div>
  );
}


function SSHKeyUpload({ onSuccess }: { onSuccess: (path: string) => void }) {
  const [keyText, setKeyText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
    const trimmed = keyText.trim();
    if (!trimmed) return;
    setUploading(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/upload-ssh-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key_content: trimmed }),
      });
      let data: { detail?: string; success?: boolean; path?: string } = {};
      try { data = await res.json(); } catch { /* non-JSON body */ }
      if (!res.ok) {
        setError(data.detail ?? `Server error (${res.status})`);
      } else {
        setUploaded(true);
        setKeyText('');
        onSuccess(data.path ?? '');
      }
    } catch {
      setError('Could not reach server');
    } finally {
      setUploading(false);
    }
  }

  function handleFileRead(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setKeyText((ev.target?.result as string) ?? '');
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Key className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-medium">Load SSH Private Key</h3>
      </div>
      <p className="text-sm text-gray-400">
        Generate a key on your local machine, then paste the private key below.
        QuietKeep stores it securely and derives the public key automatically.
        Use <strong className="text-gray-200">Deploy SSH Key to Hosts</strong> below to authorize it on each managed host.
      </p>
      {uploaded && (
        <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
          <Check className="h-4 w-4 flex-shrink-0" />
          Key loaded successfully. The public key is now shown above.
        </div>
      )}
      <textarea
        value={keyText}
        onChange={e => { setKeyText(e.target.value); setUploaded(false); setError(null); }}
        placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'}
        rows={6}
        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs font-mono focus:outline-none focus:border-emerald-500 resize-none"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          onClick={handleUpload}
          disabled={!keyText.trim() || uploading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-medium transition-colors"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Load Key
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-sm font-medium transition-colors"
        >
          Browse file
        </button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileRead} />
        <span className="text-xs text-gray-500">Accepted: ed25519, rsa, ecdsa</span>
      </div>
    </div>
  );
}




type DeployStatus = 'idle' | 'deploying' | 'success' | 'failed';

function DeployKeySection({ hosts }: { hosts: Host[] }) {
  const [open, setOpen] = useState(false);
  const [samePassword, setSamePassword] = useState(true);
  const [commonPassword, setCommonPassword] = useState('');
  const [hostPasswords, setHostPasswords] = useState<Record<number, string>>({});
  const [statuses, setStatuses] = useState<Record<number, DeployStatus>>({});
  const [messages, setMessages] = useState<Record<number, string>>({});
  const [deployingAll, setDeployingAll] = useState(false);

  async function deployToHost(hostId: number, password: string) {
    if (!password) return;
    setStatuses(prev => ({ ...prev, [hostId]: 'deploying' }));
    try {
      const res = await fetch('/api/settings/deploy-public-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host_id: hostId, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatuses(prev => ({ ...prev, [hostId]: 'failed' }));
        setMessages(prev => ({ ...prev, [hostId]: data.detail ?? 'Request failed' }));
      } else {
        setStatuses(prev => ({ ...prev, [hostId]: data.success ? 'success' : 'failed' }));
        setMessages(prev => ({ ...prev, [hostId]: data.message }));
      }
    } catch {
      setStatuses(prev => ({ ...prev, [hostId]: 'failed' }));
      setMessages(prev => ({ ...prev, [hostId]: 'Could not reach server' }));
    }
  }

  async function deployToAll() {
    setDeployingAll(true);
    for (const host of hosts) {
      const password = samePassword ? commonPassword : (hostPasswords[host.id] ?? '');
      if (!password) continue;
      await deployToHost(host.id, password);
    }
    setDeployingAll(false);
  }

  return (
    <div className="border border-gray-800 rounded-lg">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-800/30 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-medium">Deploy SSH Key to Hosts</span>
          <span className="text-xs text-gray-500">Authorize QuietKeep on each managed host</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-800 p-6 space-y-5 text-sm">
          <p className="text-gray-400">
            QuietKeep will connect to each host using the password you provide and add its public key
            to <code className="text-xs">~/.ssh/authorized_keys</code>. After this, password authentication
            is no longer needed.
          </p>
          <div className="bg-gray-800/50 rounded-lg p-3 text-xs text-gray-400 flex items-start gap-2">
            <Info className="h-4 w-4 text-blue-400 flex-shrink-0 mt-0.5" />
            <span>Passwords are transmitted over HTTPS and are never stored or logged.</span>
          </div>

          {hosts.length === 0 ? (
            <p className="text-gray-500 text-sm">No hosts configured. Add hosts first.</p>
          ) : (
            <>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={samePassword}
                  onChange={e => setSamePassword(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
                />
                <span className="text-gray-300">Use the same password for all hosts</span>
              </label>

              {samePassword && (
                <div className="flex gap-3">
                  <input
                    type="password"
                    value={commonPassword}
                    onChange={e => setCommonPassword(e.target.value)}
                    placeholder="Password for all hosts"
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={deployToAll}
                    disabled={!commonPassword || deployingAll}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-medium transition-colors whitespace-nowrap"
                  >
                    {deployingAll && <Loader2 className="h-4 w-4 animate-spin" />}
                    Deploy to All
                  </button>
                </div>
              )}

              <div className="space-y-2">
                {hosts.map(host => {
                  const status = statuses[host.id] ?? 'idle';
                  const message = messages[host.id];
                  const pw = samePassword ? commonPassword : (hostPasswords[host.id] ?? '');
                  return (
                    <div key={host.id} className="flex items-center gap-3 p-3 bg-gray-800/40 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{host.hostname}</p>
                        <p className="text-xs text-gray-500">{host.ip_address} · {host.username}</p>
                        {message && (
                          <p className={`text-xs mt-0.5 ${status === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                            {message}
                          </p>
                        )}
                      </div>

                      {!samePassword && (
                        <input
                          type="password"
                          value={hostPasswords[host.id] ?? ''}
                          onChange={e => setHostPasswords(prev => ({ ...prev, [host.id]: e.target.value }))}
                          placeholder="Password"
                          className="w-36 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs focus:outline-none focus:border-emerald-500"
                        />
                      )}

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {status === 'deploying' && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
                        {status === 'success' && <Check className="h-4 w-4 text-emerald-400" />}
                        {status === 'failed' && <X className="h-4 w-4 text-red-400" />}
                        <button
                          onClick={() => deployToHost(host.id, pw)}
                          disabled={!pw || status === 'deploying'}
                          className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-xs font-medium transition-colors"
                        >
                          {status === 'failed' ? 'Retry' : 'Deploy'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SSHSection({
  localSettings, setLocalSettings, save, handleChange, saving, saved, hosts,
}: {
  localSettings: AppSettings;
  setLocalSettings: (s: AppSettings) => void;
  save: (u: AppSettingsUpdate) => Promise<void>;
  handleChange: (k: keyof AppSettingsUpdate, v: string | number | boolean) => void;
  saving: boolean;
  saved: boolean;
  hosts: Host[];
}) {
  const [pubKeyRefresh, setPubKeyRefresh] = useState(0);

  function handleKeyUploaded(path: string) {
    setPubKeyRefresh(n => n + 1);
    if (path) {
      setLocalSettings({ ...localSettings, ssh_key_path: path });
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">SSH</h2>
          <p className="text-xs text-gray-500 mt-1">SSH connection settings for managed hosts</p>
        </div>
        <SaveIndicator saving={saving} saved={saved} />
      </div>
      <SSHKeyUpload onSuccess={handleKeyUploaded} />
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium mb-1">Private Key Path</label>
          <input
            type="text"
            value={localSettings.ssh_key_path}
            onChange={e => setLocalSettings({ ...localSettings, ssh_key_path: e.target.value })}
            onBlur={() => save({ ssh_key_path: localSettings.ssh_key_path })}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
          />
          <p className="text-xs text-gray-500 mt-1">Absolute path to the SSH private key used for all host connections.</p>
        </div>
        <SSHPublicKeyDisplay refreshKey={pubKeyRefresh} />
        <div>
          <label className="block text-sm font-medium mb-1">Connection Timeout (seconds)</label>
          <input
            type="number"
            min={1}
            max={120}
            value={localSettings.ssh_timeout}
            onChange={e => handleChange('ssh_timeout', parseInt(e.target.value) || 15)}
            className="w-32 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
          />
          <p className="text-xs text-gray-500 mt-1">How long to wait for an SSH connection before timing out.</p>
        </div>
      </div>
      <DeployKeySection hosts={hosts} />
    </section>
  );
}


function SecuritySection() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pwSubmitting, setPwSubmitting] = useState(false);

  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  const [totpQr, setTotpQr] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpMsg, setTotpMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [totpLoading, setTotpLoading] = useState(false);

  // Check current 2FA status
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setTotpEnabled(d.totp_enabled ?? false))
      .catch(() => {});
  }, []);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (newPassword.length < 8) { setPwMsg({ type: 'err', text: 'Password must be at least 8 characters' }); return; }
    if (newPassword !== confirmPw) { setPwMsg({ type: 'err', text: 'Passwords do not match' }); return; }
    setPwSubmitting(true);
    const res = await fetch('/api/auth/change-password', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    });
    const data = await res.json().catch(() => ({ detail: 'Failed' }));
    setPwSubmitting(false);
    if (res.ok) { setPwMsg({ type: 'ok', text: 'Password changed' }); setNewPassword(''); setConfirmPw(''); }
    else { setPwMsg({ type: 'err', text: data.detail || 'Failed' }); }
  }

  async function startTotpSetup() {
    setTotpMsg(null);
    setTotpLoading(true);
    const res = await fetch('/api/auth/totp/setup', { method: 'POST', credentials: 'include' });
    const data = await res.json().catch(() => null);
    setTotpLoading(false);
    if (res.ok && data) {
      setTotpQr(data.qr_code);
      setTotpSecret(data.secret);
    } else {
      setTotpMsg({ type: 'err', text: 'Failed to generate QR code' });
    }
  }

  async function verifyTotp() {
    setTotpMsg(null);
    const res = await fetch('/api/auth/totp/verify', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: totpCode }),
    });
    const data = await res.json().catch(() => ({ detail: 'Failed' }));
    if (res.ok) {
      setTotpEnabled(true);
      setTotpQr(null);
      setTotpSecret(null);
      setTotpCode('');
      setTotpMsg({ type: 'ok', text: '2FA enabled successfully' });
    } else {
      setTotpMsg({ type: 'err', text: data.detail || 'Invalid code' });
    }
  }

  async function disableTotp() {
    setTotpMsg(null);
    if (!totpCode || totpCode.length !== 6) { setTotpMsg({ type: 'err', text: 'Enter your current 6-digit code to disable' }); return; }
    const res = await fetch('/api/auth/totp/disable', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: totpCode }),
    });
    const data = await res.json().catch(() => ({ detail: 'Failed' }));
    if (res.ok) {
      setTotpEnabled(false);
      setTotpCode('');
      setTotpMsg({ type: 'ok', text: '2FA disabled' });
    } else {
      setTotpMsg({ type: 'err', text: data.detail || 'Invalid code' });
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Security</h2>
        <p className="text-xs text-gray-500 mt-1">Password and two-factor authentication</p>
      </div>

      {/* Change Password */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-4">Change Password</h3>
        <form onSubmit={handleChangePassword} className="space-y-3 max-w-sm">
          <input
            type="password"
            placeholder="New password (min 8 chars)"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
            autoComplete="new-password"
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPw}
            onChange={e => setConfirmPw(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
            autoComplete="new-password"
          />
          {pwMsg && (
            <p className={`text-xs px-3 py-2 rounded-lg ${pwMsg.type === 'ok' ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'}`}>
              {pwMsg.text}
            </p>
          )}
          <button
            type="submit"
            disabled={pwSubmitting || !newPassword || !confirmPw}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {pwSubmitting ? 'Saving...' : 'Update Password'}
          </button>
        </form>
      </div>

      {/* Two-Factor Authentication */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Two-Factor Authentication (2FA)</h3>
          {totpEnabled !== null && (
            <span className={`text-xs px-2 py-0.5 rounded-full ${totpEnabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
              {totpEnabled ? 'Enabled' : 'Not enabled'}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Adds an extra layer of security by requiring a code from your authenticator app (Google Authenticator, Authy, etc.) when signing in. <span className="text-yellow-400 font-medium">Highly recommended.</span>
        </p>

        {totpEnabled === false && !totpQr && (
          <button
            onClick={startTotpSetup}
            disabled={totpLoading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {totpLoading ? 'Generating...' : 'Enable 2FA'}
          </button>
        )}

        {totpQr && (
          <div className="space-y-4">
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 max-w-xs">
              <p className="text-xs text-gray-400 mb-3">Scan this QR code with your authenticator app:</p>
              <img src={totpQr} alt="TOTP QR Code" className="mx-auto w-48 h-48 rounded" />
              {totpSecret && (
                <p className="text-[10px] text-gray-500 mt-3 text-center break-all font-mono">
                  Manual entry: {totpSecret}
                </p>
              )}
            </div>
            <div className="max-w-xs">
              <label className="block text-xs font-medium text-gray-400 mb-1">Enter the 6-digit code to verify:</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm font-mono tracking-widest text-center focus:outline-none focus:border-emerald-500"
                  placeholder="000000"
                />
                <button
                  onClick={verifyTotp}
                  disabled={totpCode.length !== 6}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Verify
                </button>
              </div>
            </div>
          </div>
        )}

        {totpEnabled && (
          <div className="max-w-xs">
            <label className="block text-xs font-medium text-gray-400 mb-1">Enter current code to disable 2FA:</label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={totpCode}
                onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm font-mono tracking-widest text-center focus:outline-none focus:border-emerald-500"
                placeholder="000000"
              />
              <button
                onClick={disableTotp}
                disabled={totpCode.length !== 6}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Disable
              </button>
            </div>
          </div>
        )}

        {totpMsg && (
          <p className={`text-xs px-3 py-2 rounded-lg mt-3 ${totpMsg.type === 'ok' ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'}`}>
            {totpMsg.text}
          </p>
        )}
      </div>
    </section>
  );
}


export default function SettingsPage({ initialSection }: { initialSection?: string }) {
  const { settings: data, loading } = useSettings();
  const { hosts } = useHosts();
  const [activeSection, setActiveSection] = useState<Section>((initialSection as Section) ?? 'general');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [localSettings, setLocalSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    if (data && !localSettings) {
      setLocalSettings(data);
    }
  }, [data, localSettings]);

  async function save(updates: AppSettingsUpdate) {
    setSaving(true);
    setSaved(false);
    clearTimeout(savedTimer.current);
    try {
      const result = await updateSettings(updates);
      setLocalSettings(result);
      setSaved(true);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
    } catch {
      // Keep local state, let user retry
    } finally {
      setSaving(false);
    }
  }

  function handleChange(key: keyof AppSettingsUpdate, value: string | number | boolean) {
    if (!localSettings) return;
    setLocalSettings({ ...localSettings, [key]: value });
    save({ [key]: value });
    if (key === 'theme' && typeof value === 'string') {
      applyTheme(value);
    }
  }

  if (loading || !localSettings) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="flex gap-6">
      {/* Sidebar */}
      <nav className="w-44 flex-shrink-0">
        <ul className="space-y-0.5 sticky top-4">
          {SECTIONS.map(s => (
            <li key={s.id}>
              <button
                onClick={() => setActiveSection(s.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeSection === s.id
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                }`}
              >
                {s.icon}
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* General */}
        {activeSection === 'general' && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight">General</h2>
                <p className="text-xs text-gray-500 mt-1">Appearance and display preferences</p>
              </div>
              <SaveIndicator saving={saving} saved={saved} />
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-6">
              <div>
                <label className="block text-sm font-medium mb-3">Theme</label>
                <div className="flex gap-3">
                  {[
                    { value: 'light', label: 'Light', icon: <Sun className="h-4 w-4" /> },
                    { value: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" /> },
                    { value: 'system', label: 'System', icon: <Monitor className="h-4 w-4" /> },
                  ].map(t => (
                    <button
                      key={t.value}
                      onClick={() => handleChange('theme', t.value)}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                        localSettings.theme === t.value
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                          : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      {t.icon}
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">Choose your preferred color mode. System follows your OS preference.</p>
              </div>
            </div>
          </section>
        )}

        {/* SSH */}
        {activeSection === 'ssh' && (
          <SSHSection
            localSettings={localSettings}
            setLocalSettings={setLocalSettings}
            save={save}
            handleChange={handleChange}
            saving={saving}
            saved={saved}
            hosts={hosts}
          />
        )}

        {/* Scanning */}
        {activeSection === 'scanning' && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight">Scanning</h2>
                <p className="text-xs text-gray-500 mt-1">Automatic scan schedule for patches and Docker stacks</p>
              </div>
              <SaveIndicator saving={saving} saved={saved} />
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">Auto-Scan</label>
                  <p className="text-xs text-gray-500">Automatically scan hosts on a schedule</p>
                </div>
                <button
                  onClick={() => handleChange('auto_scan_enabled', !localSettings.auto_scan_enabled)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    localSettings.auto_scan_enabled ? 'bg-emerald-500' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`block w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      localSettings.auto_scan_enabled ? 'translate-x-5.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
              <div className={localSettings.auto_scan_enabled ? '' : 'opacity-40 pointer-events-none'}>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium mb-1">System Scan Interval (hours)</label>
                    <input
                      type="number"
                      min={1}
                      max={48}
                      value={localSettings.scan_interval_hours}
                      onChange={e => handleChange('scan_interval_hours', parseInt(e.target.value) || 6)}
                      className="w-32 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">How often to check for system package updates.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Docker Scan Interval (hours)</label>
                    <input
                      type="number"
                      min={1}
                      max={48}
                      value={localSettings.docker_scan_interval_hours}
                      onChange={e => handleChange('docker_scan_interval_hours', parseInt(e.target.value) || 6)}
                      className="w-32 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">How often to check Docker stacks for image updates.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Security */}
        {activeSection === 'security' && (
          <SecuritySection />
        )}

        {/* Hosts */}
        {activeSection === 'hosts' && (
          <section>
            <HostManagement />
          </section>
        )}

        {/* About */}
        {activeSection === 'about' && (
          <section className="space-y-6">
            <div>
              <h2 className="text-xl font-bold tracking-tight">About</h2>
              <p className="text-xs text-gray-500 mt-1">Application information</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-4">
                <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" className="h-12 w-12">
                  <path d="M32 4L8 14v18c0 16 24 28 24 28s24-12 24-28V14L32 4z" fill="#0a0e17" stroke="#10b981" strokeWidth="3"/>
                  <text x="32" y="42" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="bold" fontSize="22" fill="#60a5fa" letterSpacing="-1">QW</text>
                </svg>
                <div>
                  <h3 className="text-lg font-bold">QuietKeep</h3>
                  <p className="text-sm text-gray-400">Lightweight Linux Patch Management</p>
                </div>
              </div>
              <div className="border-t border-gray-800 pt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Version</span>
                  <span className="font-mono text-gray-200">{localSettings.app_version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">License</span>
                  <span className="text-gray-200">AGPL-3.0</span>
                </div>
              </div>
              <div className="border-t border-gray-800 pt-4 space-y-2 text-sm">
                <a
                  href="https://github.com/quietwire-dev/quietkeep"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-blue-400 hover:text-blue-300 transition-colors"
                >
                  GitHub Repository
                </a>
                <a
                  href="https://quietwire.dev"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-blue-400 hover:text-blue-300 transition-colors"
                >
                  quietwire.dev
                </a>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
