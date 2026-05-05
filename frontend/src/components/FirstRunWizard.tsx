// QuietKeep: FirstRunWizard.tsx
// Shown on first launch when no hosts exist. Guides the user through:
// 1. Welcome (what QuietKeep does)
// 2. Deployment type (Docker Desktop vs dedicated server)
// 3. SSH key explanation (plain language, why dedicated, how to generate)
// 4. Permissions/sudoers (what commands QuietKeep needs, why, how to set up)
// 5. Add hosts (manual or CSV)
// 6. Done (next steps)
// Written for users who may be new to SSH and Linux administration.
// Author: QuietWire (Dennis Ayotte)

import { useState, useRef, useEffect } from 'react';
import { Server, Upload, FileDown, Plus, ArrowRight, ArrowLeft, CheckCircle2, Loader2, Check, X, Info, Key, Shield, Monitor, Copy } from 'lucide-react';
import type { HostCreate, CSVImportResult } from '../types';
import { createHost, importHostsCSV, downloadHostsTemplate } from '../hooks/useApi';

const OS_OPTIONS = [
  { value: 'apt', label: 'Debian/Ubuntu' },
  { value: 'kali', label: 'Kali Linux' },
  { value: 'pacman', label: 'Arch/CachyOS' },
  { value: 'proxmox', label: 'Proxmox' },
];

const EMPTY_HOST: HostCreate = {
  hostname: '',
  ip_address: '',
  username: '',
  os_type: 'apt',
  is_patch_target: true,
  has_docker: false,
};

type Step = 'welcome' | 'deploy-type' | 'ssh-explain' | 'permissions' | 'preflight' | 'choose' | 'add-host' | 'import-csv' | 'deploy-keys' | 'done';
type DeployType = 'dedicated' | 'desktop' | null;

interface PreflightCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail' | 'info';
  detail: string;
  required: string;
}

interface Props {
  onComplete: (destination?: string, sshReady?: boolean) => void;
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5 mb-6">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i <= current ? 'w-6 bg-emerald-500' : 'w-1.5 bg-gray-700'
          }`}
        />
      ))}
    </div>
  );
}

function CopyBlock({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="relative">
      {label && <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{label}</p>}
      <div className="flex items-center bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <code className="flex-1 text-xs text-emerald-400 p-3 overflow-x-auto whitespace-nowrap">{text}</code>
        <button onClick={copy} className="px-3 py-2 text-gray-500 hover:text-gray-300 transition-colors" title="Copy">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

export default function FirstRunWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('welcome');
  const [deployType, setDeployType] = useState<DeployType>(null);
  const [formData, setFormData] = useState<HostCreate>(EMPTY_HOST);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<CSVImportResult | null>(null);
  const [hostsAdded, setHostsAdded] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [checks, setChecks] = useState<PreflightCheck[]>([]);
  const [checksLoading, setChecksLoading] = useState(false);
  const [pubKey, setPubKey] = useState<string | null>(null);
  const [wizardHosts, setWizardHosts] = useState<Array<{ id: number; hostname: string; ip_address: string; username: string }>>([]);
  const [deployStatus, setDeployStatus] = useState<Record<number, { status: 'idle' | 'deploying' | 'success' | 'fail'; message?: string }>>({});
  const [deployPasswords, setDeployPasswords] = useState<Record<number, string>>({});
  const [globalPassword, setGlobalPassword] = useState('');
  const [deployingAll, setDeployingAll] = useState(false);

  useEffect(() => {
    fetch('/api/settings/ssh-public-key', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.public_key) setPubKey(d.public_key); })
      .catch(() => {});
  }, []);

  async function runPreflight() {
    setChecksLoading(true);
    try {
      const res = await fetch('/api/settings/preflight', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setChecks(data.checks);
      }
    } catch {
      setChecks([{ name: 'Connection', status: 'fail', detail: 'Could not reach QuietKeep backend', required: 'Backend running' }]);
    } finally {
      setChecksLoading(false);
    }
  }

  async function fetchWizardHosts() {
    try {
      const res = await fetch('/api/hosts', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setWizardHosts(data.map((h: { id: number; hostname: string; ip_address: string; username: string }) => ({
          id: h.id, hostname: h.hostname, ip_address: h.ip_address, username: h.username,
        })));
      }
    } catch { /* ignore */ }
  }

  async function deployKeyToHost(hostId: number, password: string) {
    setDeployStatus(prev => ({ ...prev, [hostId]: { status: 'deploying' } }));
    try {
      const res = await fetch('/api/settings/deploy-public-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ host_id: hostId, password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setDeployStatus(prev => ({ ...prev, [hostId]: { status: 'success', message: data.message } }));
      } else {
        setDeployStatus(prev => ({ ...prev, [hostId]: { status: 'fail', message: data.detail || data.message || 'Deploy failed' } }));
      }
    } catch {
      setDeployStatus(prev => ({ ...prev, [hostId]: { status: 'fail', message: 'Network error' } }));
    }
  }

  async function deployToAll(password: string) {
    setDeployingAll(true);
    try {
      for (const host of wizardHosts) {
        await deployKeyToHost(host.id, password);
      }
    } finally {
      setDeployingAll(false);
    }
  }

  async function handleAddHost(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createHost(formData);
      setHostsAdded(prev => prev + 1);
      setFormData(EMPTY_HOST);
      if (pubKey) {
        await fetchWizardHosts();
        setStep('deploy-keys');
      } else {
        setStep('done');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add host');
    } finally {
      setSaving(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const result = await importHostsCSV(file);
      setImportResult(result);
      setHostsAdded(result.created);
      if (result.created > 0) {
        if (pubKey) {
          await fetchWizardHosts();
          setStep('deploy-keys');
        } else {
          setStep('done');
        }
      } else if (result.errors.length > 0) {
        setError(result.errors[0]);
      } else {
        setError('No new hosts found in the CSV (all duplicates).');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const stepNumber = ['welcome', 'deploy-type', 'ssh-explain', 'permissions', 'preflight', 'choose'].indexOf(step);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" className="h-10 w-10">
            <path d="M32 4L8 14v18c0 16 24 28 24 28s24-12 24-28V14L32 4z" fill="#0a0e17" stroke="#10b981" strokeWidth="3"/>
            <text x="32" y="42" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="bold" fontSize="22" fill="#60a5fa" letterSpacing="-1">QW</text>
          </svg>
          <h1 className="text-2xl font-bold tracking-tight">QuietKeep</h1>
        </div>

        {stepNumber >= 0 && <StepIndicator current={stepNumber} total={6} />}

        {/* ─── Step 1: Welcome ─── */}
        {step === 'welcome' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 space-y-6">
            <div className="text-center">
              <Server className="h-14 w-14 mx-auto text-emerald-400 opacity-60 mb-4" />
              <h2 className="text-2xl font-bold mb-2">Welcome to QuietKeep</h2>
              <p className="text-gray-400 text-sm max-w-md mx-auto">
                QuietKeep keeps your Linux servers up to date by checking for available patches
                and applying them when you say so. It connects to your servers over SSH, so
                there is nothing to install on each server.
              </p>
            </div>
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-sm space-y-2">
              <p className="text-gray-300 font-medium">How it works (the short version):</p>
              <ol className="text-gray-400 space-y-1.5 list-decimal list-inside text-xs">
                <li>QuietKeep connects to each server using an SSH key (like a secure password-free login)</li>
                <li>It checks what updates are available (it never installs anything without your permission)</li>
                <li>When you are ready, click "Patch" and it runs the update for you</li>
                <li>It can also monitor your Docker containers for newer images</li>
              </ol>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-xs space-y-2">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-amber-400 flex-shrink-0" />
                <p className="text-amber-300 font-semibold text-sm">Important: Browser Security Warning</p>
              </div>
              <p className="text-gray-300">
                You may have seen a <strong className="text-amber-300">"Your connection is not private"</strong> or
                <strong className="text-amber-300"> "Certificate not trusted"</strong> warning before reaching this page.
                <strong className="text-white"> This is normal and expected.</strong>
              </p>
              <p className="text-gray-400">
                QuietKeep uses HTTPS to encrypt everything between your browser and this server (including
                your password). On first run, it creates its own self-signed certificate. Your browser doesn't
                recognize it because it wasn't issued by a public authority. The encryption is still
                just as strong.
              </p>
              <p className="text-gray-400">
                <strong className="text-gray-300">To remove the warning permanently:</strong> put a reverse proxy
                (like Nginx Proxy Manager, Traefik, or Caddy) in front of QuietKeep with a free
                Let's Encrypt certificate. This is optional but recommended if you access QuietKeep
                from multiple devices.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => setStep('deploy-type')}
                className="flex items-center gap-2 px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium transition-colors"
              >
                Get Started
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => onComplete()}
                className="px-6 py-3 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm font-medium text-gray-400 transition-colors"
              >
                Skip setup
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 2: Deployment Type ─── */}
        {step === 'deploy-type' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 space-y-6">
            <div className="text-center">
              <h2 className="text-xl font-bold mb-2">Where is QuietKeep running?</h2>
              <p className="text-sm text-gray-400">This helps us give you the right instructions.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                onClick={() => { setDeployType('dedicated'); setStep('ssh-explain'); }}
                className={`flex flex-col items-center gap-3 p-6 rounded-lg border transition-all text-left ${
                  deployType === 'dedicated' ? 'border-emerald-500 bg-emerald-500/5' : 'border-gray-700 hover:border-emerald-500 hover:bg-gray-800/50'
                }`}
              >
                <Server className="h-8 w-8 text-emerald-400" />
                <span className="font-medium text-center">Dedicated Server / VM</span>
                <span className="text-xs text-gray-500 text-center">
                  Running on a Linux server, Proxmox VM, or cloud VPS that stays on 24/7
                </span>
              </button>
              <button
                onClick={() => { setDeployType('desktop'); setStep('ssh-explain'); }}
                className={`flex flex-col items-center gap-3 p-6 rounded-lg border transition-all text-left ${
                  deployType === 'desktop' ? 'border-emerald-500 bg-emerald-500/5' : 'border-gray-700 hover:border-emerald-500 hover:bg-gray-800/50'
                }`}
              >
                <Monitor className="h-8 w-8 text-blue-400" />
                <span className="font-medium text-center">Docker Desktop</span>
                <span className="text-xs text-gray-500 text-center">
                  Running on your Windows, Mac, or Linux workstation via Docker Desktop
                </span>
              </button>
            </div>
            {deployType === 'desktop' && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300">
                Docker Desktop works well for testing and small environments. Keep in mind that
                QuietKeep can only scan your servers while Docker Desktop is running. For always-on
                monitoring, a dedicated server is recommended.
              </div>
            )}
            <button
              onClick={() => setStep('welcome')}
              className="flex items-center gap-1 mx-auto text-sm text-gray-500 hover:text-gray-300 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
          </div>
        )}

        {/* ─── Step 3: SSH Key Explanation ─── */}
        {step === 'ssh-explain' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 space-y-6">
            <div className="text-center">
              <Key className="h-10 w-10 mx-auto text-amber-400 mb-3" />
              <h2 className="text-xl font-bold mb-2">SSH Key Setup</h2>
              <p className="text-sm text-gray-400">QuietKeep needs a way to log into your servers securely.</p>
            </div>

            <div className="space-y-4 text-sm">
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-2">
                <p className="text-gray-300 font-medium">What is an SSH key?</p>
                <p className="text-gray-400 text-xs">
                  An SSH key is like a digital lock and key. Instead of typing a password every time,
                  you give QuietKeep a private key (the "key") and put a matching public key (the "lock")
                  on each server. Only the matching key can open the lock. No password is ever sent over the network.
                </p>
              </div>

              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-2">
                <p className="text-gray-300 font-medium">Why a dedicated key for this server?</p>
                <p className="text-gray-400 text-xs">
                  Create a key that is used <strong className="text-gray-300">only</strong> by this QuietKeep installation.
                  Do not reuse your personal SSH key or a key from another server. This way:
                </p>
                <ul className="text-gray-400 text-xs list-disc list-inside space-y-0.5">
                  <li>If you ever decommission QuietKeep, just remove its key from your hosts and it is fully revoked</li>
                  <li>Your personal SSH access remains completely separate and unaffected</li>
                  <li>If this server were ever compromised, your other keys are safe</li>
                </ul>
                <p className="text-gray-500 text-xs">
                  Think of it like giving a contractor their own door key instead of a copy of yours.
                </p>
              </div>

              {pubKey ? (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" />
                    <p className="text-emerald-400 font-medium text-xs">SSH key is already configured</p>
                  </div>
                  <p className="text-gray-400 text-xs">
                    Your QuietKeep public key (this is what goes on each server):
                  </p>
                  <CopyBlock text={pubKey} />
                </div>
              ) : (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 space-y-3">
                  <p className="text-amber-400 font-medium text-xs">No SSH key configured yet</p>

                  <div className="bg-gray-900 rounded-lg p-3 space-y-2">
                    <p className="text-xs text-gray-500">Option A: One-click generate (easiest)</p>
                    <p className="text-xs text-gray-400">
                      Let QuietKeep generate a dedicated key inside its own container. Nothing is installed on your machine.
                    </p>
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch('/api/settings/generate-ssh-key', {
                            method: 'POST', credentials: 'include',
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setPubKey(data.public_key);
                          }
                        } catch { /* ignore */ }
                      }}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
                    >
                      <Key className="h-3.5 w-3.5" />
                      Generate Key for Me
                    </button>
                  </div>

                  <div className="bg-gray-900 rounded-lg p-3 space-y-2">
                    <p className="text-xs text-gray-500">Option B: Generate it yourself</p>
                    <p className="text-xs text-gray-400">
                      Run this on the machine you use to manage your servers, then paste the private key into Settings &gt; SSH:
                    </p>
                    <CopyBlock
                      text='ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_quietkeep -N ""'
                    />
                    <p className="text-gray-500 text-[10px]">
                      This creates <code className="text-gray-400">id_ed25519_quietkeep</code> (private) and <code className="text-gray-400">id_ed25519_quietkeep.pub</code> (public).
                      Paste the private key into Settings &gt; SSH after the wizard.
                    </p>
                  </div>

                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 text-[10px] text-red-300">
                    <strong>Do not</strong> reuse an existing key like <code>id_rsa</code> or <code>id_ed25519</code>.
                    Always create a fresh key named <code>id_ed25519_quietkeep</code> that is used only by this QuietKeep server.
                    If you already have SSH keys on your machine, they will not be affected.
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setStep('deploy-type')}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <button
                onClick={() => setStep('permissions')}
                className="flex items-center gap-2 px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium transition-colors"
              >
                Next
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 4: Permissions / Sudoers ─── */}
        {step === 'permissions' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 space-y-6">
            <div className="text-center">
              <Shield className="h-10 w-10 mx-auto text-blue-400 mb-3" />
              <h2 className="text-xl font-bold mb-2">Permissions</h2>
              <p className="text-sm text-gray-400">What QuietKeep can and cannot do on your servers.</p>
            </div>

            <div className="space-y-4 text-sm">
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
                <p className="text-gray-300 font-medium">QuietKeep only runs these commands:</p>
                <div className="grid grid-cols-1 gap-2 text-xs">
                  <div className="flex items-start gap-2">
                    <Check className="h-3.5 w-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-400"><code className="text-gray-300">apt-get update</code> / <code className="text-gray-300">apt-get upgrade</code> - check and install updates</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="h-3.5 w-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-400"><code className="text-gray-300">pacman -Qu</code> / <code className="text-gray-300">pacman -Syu</code> - same for Arch-based systems</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="h-3.5 w-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-400"><code className="text-gray-300">reboot</code> - only when you click "Reboot" in the UI</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="h-3.5 w-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-400"><code className="text-gray-300">docker</code> commands - only on hosts marked "Docker Enabled"</span>
                  </div>
                </div>
              </div>

              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
                <p className="text-gray-300 font-medium">What it cannot do:</p>
                <div className="grid grid-cols-1 gap-2 text-xs">
                  <div className="flex items-start gap-2">
                    <X className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-400">Cannot delete files, access your personal data, or modify system configs</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <X className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-400">Cannot install arbitrary software (only system updates)</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <X className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-400">Cannot phone home or send data anywhere (everything stays on your network)</span>
                  </div>
                </div>
              </div>

              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
                <p className="text-gray-300 font-medium">Setting up permissions (sudoers)</p>
                <p className="text-gray-400 text-xs">
                  If you connect as a non-root user (recommended), that user needs permission to run the
                  update commands without typing a password. This is done with a "sudoers" rule. You have two options:
                </p>
                <div className="space-y-2">
                  <div className="bg-gray-900 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Option A: Let QuietKeep do it (easiest)</p>
                    <p className="text-xs text-gray-400">
                      After adding a host, use the "Fix Sudoers" button in Settings &gt; Hosts. It will ask for the
                      user's password once to set up the rule automatically.
                    </p>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-3 space-y-2">
                    <p className="text-xs text-gray-500 mb-1">Option B: Do it yourself (for Debian/Ubuntu)</p>
                    <CopyBlock
                      text='echo "quietkeep ALL=(ALL) NOPASSWD: /usr/bin/apt-get, /usr/sbin/reboot" | sudo tee /etc/sudoers.d/quietkeep'
                    />
                    <p className="text-[10px] text-gray-500">
                      Replace "quietkeep" with whatever username you use. For Arch: replace <code>/usr/bin/apt-get</code> with <code>/usr/bin/pacman</code>.
                    </p>
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Using <strong className="text-gray-400">root</strong> as the SSH user? Then you can skip this step entirely - root already has full access.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setStep('ssh-explain')}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <button
                onClick={() => { setStep('preflight'); runPreflight(); }}
                className="flex items-center gap-2 px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium transition-colors"
              >
                Next
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 5: Pre-flight checks ─── */}
        {step === 'preflight' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 space-y-6">
            <div className="text-center">
              <h2 className="text-xl font-bold mb-2">System Check</h2>
              <p className="text-sm text-gray-400">Verifying your QuietKeep environment before we continue</p>
            </div>
            {checksLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
              </div>
            ) : (
              <div className="space-y-2">
                {checks.map((c, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      {c.status === 'ok' && <Check className="h-5 w-5 text-emerald-400" />}
                      {c.status === 'warn' && <Info className="h-5 w-5 text-amber-400" />}
                      {c.status === 'fail' && <X className="h-5 w-5 text-red-400" />}
                      {c.status === 'info' && <Info className="h-5 w-5 text-gray-400" />}
                      <div>
                        <p className="text-sm font-medium">{c.name}</p>
                        <p className="text-xs text-gray-500">{c.detail}</p>
                      </div>
                    </div>
                    <span className="text-xs text-gray-500">{c.required}</span>
                  </div>
                ))}
              </div>
            )}
            {!checksLoading && checks.some(c => c.status === 'warn' && c.name === 'SSH Key') && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-300">
                No SSH key configured yet. You can still add hosts now and configure the key later in Settings &gt; SSH.
              </div>
            )}
            {!checksLoading && checks.some(c => c.status === 'fail') && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
                Some checks failed. You can still continue, but some features may not work until resolved.
              </div>
            )}
            {!checksLoading && (
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setStep('permissions')}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                <button
                  onClick={() => setStep('choose')}
                  className="flex items-center gap-2 px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium transition-colors"
                >
                  Add Hosts
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ─── Step 6: Choose method ─── */}
        {step === 'choose' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 space-y-6">
            <h2 className="text-xl font-bold text-center">Add Your Hosts</h2>
            <p className="text-sm text-gray-400 text-center">
              A "host" is any Linux server you want QuietKeep to manage. You need at least one to get started.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                onClick={() => setStep('add-host')}
                className="flex flex-col items-center gap-3 p-6 rounded-lg border border-gray-700 hover:border-emerald-500 hover:bg-gray-800/50 transition-all"
              >
                <Plus className="h-8 w-8 text-emerald-400" />
                <span className="font-medium">Add Manually</span>
                <span className="text-xs text-gray-500 text-center">Enter hostname, IP, and user for one server</span>
              </button>
              <button
                onClick={() => setStep('import-csv')}
                className="flex flex-col items-center gap-3 p-6 rounded-lg border border-gray-700 hover:border-emerald-500 hover:bg-gray-800/50 transition-all"
              >
                <Upload className="h-8 w-8 text-blue-400" />
                <span className="font-medium">Import CSV</span>
                <span className="text-xs text-gray-500 text-center">Add multiple servers at once from a spreadsheet</span>
              </button>
            </div>
            <button
              onClick={() => setStep('preflight')}
              className="flex items-center gap-1 mx-auto text-sm text-gray-500 hover:text-gray-300 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
          </div>
        )}

        {/* ─── Add host form ─── */}
        {step === 'add-host' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
            <h2 className="text-xl font-bold mb-2">Add a Host</h2>
            <p className="text-xs text-gray-500 mb-6">
              Enter the details for one server. You can add more later from Settings &gt; Hosts.
            </p>
            <form onSubmit={handleAddHost} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Hostname</label>
                  <input
                    type="text"
                    value={formData.hostname}
                    onChange={e => setFormData({ ...formData, hostname: e.target.value })}
                    required
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
                    placeholder="web-server-01"
                  />
                  <p className="text-[10px] text-gray-600 mt-0.5">A friendly name for this server</p>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">IP Address</label>
                  <input
                    type="text"
                    value={formData.ip_address}
                    onChange={e => setFormData({ ...formData, ip_address: e.target.value })}
                    required
                    pattern="^(\d{1,3}\.){3}\d{1,3}$"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
                    placeholder="192.168.1.100"
                  />
                  <p className="text-[10px] text-gray-600 mt-0.5">The server's IP on your network</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">SSH Username</label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={e => setFormData({ ...formData, username: e.target.value })}
                    required
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
                    placeholder="quietkeep"
                  />
                  <p className="text-[10px] text-gray-600 mt-0.5">The user to log in as (root or a sudoer)</p>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">OS Type</label>
                  <select
                    value={formData.os_type}
                    onChange={e => setFormData({ ...formData, os_type: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
                  >
                    {OS_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-600 mt-0.5">Determines which package manager to use</p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_patch_target}
                    onChange={e => setFormData({ ...formData, is_patch_target: e.target.checked })}
                    className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
                  />
                  Patch Target
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.has_docker}
                    onChange={e => setFormData({ ...formData, has_docker: e.target.checked })}
                    className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
                  />
                  Docker Enabled
                </label>
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => { setStep('choose'); setError(null); }}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-medium transition-colors"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Add Host
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ─── Import CSV ─── */}
        {step === 'import-csv' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 space-y-6">
            <h2 className="text-xl font-bold">Import Hosts from CSV</h2>
            <p className="text-xs text-gray-500">
              If you have a spreadsheet of servers, export it as CSV and upload it here.
            </p>
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-sm space-y-3">
              <p className="text-gray-300 font-medium">CSV Format</p>
              <p className="text-gray-400 text-xs">
                Your file needs a header row with these columns:
              </p>
              <code className="block text-xs text-emerald-400 bg-gray-900 rounded p-3 overflow-x-auto">
                hostname,ip_address,username,os_type,is_patch_target,has_docker
              </code>
              <div className="text-xs text-gray-500 space-y-1">
                <p><strong>Required:</strong> hostname, ip_address, username, os_type (apt, kali, pacman, proxmox)</p>
                <p><strong>Optional:</strong> is_patch_target (default: true), has_docker (default: false)</p>
              </div>
              <button
                onClick={downloadHostsTemplate}
                className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                <FileDown className="h-3.5 w-3.5" />
                Download example template
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleImport}
              className="hidden"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            {importResult && importResult.created === 0 && (
              <p className="text-sm text-gray-400">
                {importResult.skipped} hosts skipped (already exist).
                {importResult.errors.length > 0 && ` ${importResult.errors.length} rows had errors.`}
              </p>
            )}
            <div className="flex items-center justify-between">
              <button
                onClick={() => { setStep('choose'); setError(null); setImportResult(null); }}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium transition-colors"
              >
                <Upload className="h-4 w-4" />
                Choose CSV File
              </button>
            </div>
          </div>
        )}

        {/* ─── Deploy Keys ─── */}
        {step === 'deploy-keys' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 space-y-6">
            <div className="text-center">
              <Key className="h-12 w-12 mx-auto text-amber-400 opacity-70 mb-3" />
              <h2 className="text-xl font-bold">Deploy SSH Key to Hosts</h2>
              <p className="text-gray-400 text-sm mt-1">
                QuietKeep needs its public key on each host before it can connect.
                Enter the SSH password for each host to deploy the key automatically.
              </p>
            </div>

            {pubKey && (
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-1">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">QuietKeep Public Key</p>
                <CopyBlock text={pubKey} />
              </div>
            )}

            {/* Global deploy */}
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 space-y-3">
              <p className="text-xs text-emerald-300 font-medium">Deploy to all hosts at once</p>
              <p className="text-xs text-gray-400">
                If all your hosts use the same SSH password, enter it once and deploy to every host:
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={globalPassword}
                  onChange={(e) => setGlobalPassword(e.target.value)}
                  className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder="SSH password for all hosts"
                />
                <button
                  onClick={() => { if (globalPassword) deployToAll(globalPassword); }}
                  disabled={!globalPassword || wizardHosts.some(h => deployStatus[h.id]?.status === 'deploying')}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium transition-colors whitespace-nowrap"
                >
                  Deploy to All
                </button>
              </div>
            </div>

            {/* Per-host list */}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {wizardHosts.map(host => {
                const status = deployStatus[host.id];
                return (
                  <div key={host.id} className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-200 truncate">{host.hostname}</p>
                      <p className="text-[10px] text-gray-500">{host.ip_address} • {host.username}</p>
                    </div>
                    {status?.status === 'success' ? (
                      <div className="flex items-center gap-1 text-emerald-400 text-xs">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Deployed
                      </div>
                    ) : status?.status === 'deploying' ? (
                      <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />
                    ) : (
                      <div className="flex items-center gap-2">
                        {status?.status === 'fail' && (
                          <span className="text-[10px] text-red-400 max-w-[150px] truncate" title={status.message}>{status.message}</span>
                        )}
                        <input
                          type="password"
                          value={deployPasswords[host.id] || ''}
                          onChange={(e) => setDeployPasswords(prev => ({ ...prev, [host.id]: e.target.value }))}
                          className="w-32 px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors"
                          placeholder="Password"
                        />
                        <button
                          onClick={() => deployKeyToHost(host.id, deployPasswords[host.id] || '')}
                          disabled={!deployPasswords[host.id]}
                          className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[10px] font-medium transition-colors"
                        >
                          Deploy
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-xs text-gray-400 space-y-1">
              <p className="text-gray-500 font-medium">Prefer to do this manually?</p>
              <p>Copy the public key above and add it to <code className="text-gray-300">~/.ssh/authorized_keys</code> on each host, or run:</p>
              <CopyBlock text={`echo "${pubKey}" >> ~/.ssh/authorized_keys`} />
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setStep('choose')}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <button
                onClick={() => setStep('done')}
                disabled={deployingAll || Object.values(deployStatus).some(s => s.status === 'deploying')}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-medium transition-colors"
              >
                {deployingAll || Object.values(deployStatus).some(s => s.status === 'deploying')
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Deploying...</>
                  : <>{Object.values(deployStatus).some(s => s.status === 'success') ? 'Continue' : 'Skip for Now'} <ArrowRight className="h-4 w-4" /></>
                }
              </button>
            </div>
          </div>
        )}

        {/* ─── Done ─── */}
        {step === 'done' && (() => {
          const keysDeployed = Object.values(deployStatus).some(s => s.status === 'success');
          const keyExists = !!pubKey;
          // Auto-scan whenever a key exists. Keys may have been deployed
          // manually outside the wizard, and failed scans are harmless.
          const readyToScan = keyExists;
          return (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center space-y-6">
            <CheckCircle2 className="h-16 w-16 mx-auto text-emerald-400" />
            <div>
              <h2 className="text-2xl font-bold mb-2">You are all set!</h2>
              <p className="text-gray-400">
                {hostsAdded === 1
                  ? '1 host has been added successfully.'
                  : `${hostsAdded} hosts have been added successfully.`}
              </p>
            </div>

            {!keyExists && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 text-left text-sm space-y-2">
                <p className="font-medium text-amber-400">Next: Configure your SSH key</p>
                <p className="text-gray-400 text-xs">
                  QuietKeep still needs an SSH key before it can connect to your hosts. Go to
                  Settings &gt; SSH to paste in your private key, then use "Deploy Key" to push
                  it to your hosts.
                </p>
              </div>
            )}

            {keyExists && !keysDeployed && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 text-left text-sm space-y-2">
                <p className="font-medium text-amber-400">Next: Deploy your SSH key to hosts</p>
                <p className="text-gray-400 text-xs">
                  Your SSH key is generated but hasn't been deployed to any hosts yet.
                  Go to Settings &gt; Hosts and use the deploy button next to each host, or
                  go back and deploy from the previous step.
                </p>
              </div>
            )}

            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-left text-sm space-y-2">
              <p className="text-gray-300 font-medium text-xs">What happens next:</p>
              <ol className="text-gray-400 text-xs space-y-1 list-decimal list-inside">
                {readyToScan ? (
                  <li>A scan will start automatically to check for available updates</li>
                ) : !keyExists ? (
                  <li>Configure your SSH key in Settings &gt; SSH, deploy it to hosts, then run your first scan</li>
                ) : (
                  <li>Deploy your SSH key to hosts (Settings &gt; Hosts), then click "Scan All" on the Home page</li>
                )}
                <li>The Home page will show which servers have updates ready</li>
                <li>Click "Patch" when you want to apply them (nothing is automatic)</li>
              </ol>
            </div>

            <div className="flex flex-col items-center gap-3">
              {!keyExists ? (
                <button
                  onClick={() => onComplete('settings:ssh', false)}
                  className="flex items-center gap-2 px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium transition-colors"
                >
                  Configure SSH Key
                  <ArrowRight className="h-4 w-4" />
                </button>
              ) : !keysDeployed ? (
                <button
                  onClick={() => setStep('deploy-keys')}
                  className="flex items-center gap-2 px-6 py-3 rounded-lg bg-amber-600 hover:bg-amber-500 font-medium transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Deploy Keys to Hosts
                </button>
              ) : (
                <button
                  onClick={() => onComplete(undefined, true)}
                  className="flex items-center gap-2 px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium transition-colors"
                >
                  Go to Dashboard
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => onComplete(undefined, readyToScan)}
                className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                {readyToScan ? 'Skip' : "I'll do this later"}
              </button>
            </div>
          </div>
          );
        })()}
      </div>
    </div>
  );
}
