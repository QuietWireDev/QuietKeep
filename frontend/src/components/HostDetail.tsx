// QuietKeep: HostDetail.tsx
// Single-host detail view. Shows host info, pending packages table, patch history
// with expandable log viewer, and action buttons (scan, patch, reboot).
// After patching, automatically triggers a re-scan so the UI shows fresh data.
// Author: QuietWire (Dennis Ayotte)

import { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Play, RefreshCw, RotateCw, Package, Clock, Loader2, ChevronDown, ChevronRight, Terminal, ShieldCheck, ShieldAlert, ShieldQuestion, KeyRound, Cpu, Activity } from 'lucide-react';
import type { Host } from '../types';
import { formatUTC, formatUptime } from '../utils/formatDate';
import { useHostDetail, useHistory, triggerScanHost, triggerPatchHost, triggerReboot, triggerInstallHeldBack, fixSudoers } from '../hooks/useApi';
import ConfirmDialog from './ConfirmDialog';
import FixSudoersModal from './FixSudoersModal';
import KeyringHelpModal from './KeyringHelpModal';

// Detect the backend marker that patcher.py prepends to log_output when an
// apt run fails with a GPG key rotation (NO_PUBKEY etc.). Kept as a single
// source of truth so the banner and the auto-popup stay in sync.
const KEYRING_MARKER = '[QK_KEYRING_ISSUE]';
const hasKeyringIssue = (log: string | null | undefined): boolean =>
  !!log && log.includes(KEYRING_MARKER);

// Pull the first apt error line(s) out of the log so the modal can show the
// operator the exact message from the host without dumping the whole log.
const extractKeyringErrorExcerpt = (log: string | null | undefined): string => {
  if (!log) return '';
  const lines = log.split('\n').filter((l) =>
    /NO_PUBKEY|EXPKEYSIG|KEYEXPIRED|signatures couldn't be verified|signatures were invalid|GPG error|is not signed/i.test(l)
  );
  return lines.slice(0, 6).join('\n');
};

interface HostDetailProps {
  host: Host;
  onBack: () => void;
}

export default function HostDetail({ host, onBack }: HostDetailProps) {
  const { host: detail, loading, refresh } = useHostDetail(host.id);
  const { history, loading: historyLoading, refresh: refreshHistory } = useHistory(host.id);
  const [scanning, setScanning] = useState(false);
  const [patching, setPatching] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const [installingHeldBack, setInstallingHeldBack] = useState(false);
  const [patchMessage, setPatchMessage] = useState('');
  const [expandedLog, setExpandedLog] = useState<number | null>(null);
  // Which confirmation modal is currently open. Only one can be visible at a
  // time. null means no modal. See BUG-003 for why we no longer use confirm().
  const [pendingAction, setPendingAction] = useState<'patch' | 'reboot' | 'install-held-back' | null>(null);
  const [sudoersModalOpen, setSudoersModalOpen] = useState(false);
  // Tracks the most recent patch-history id we've already shown the keyring
  // popup for, so a user coming back to the page doesn't get the modal
  // re-triggered every render. The banner still stays visible as long as the
  // latest entry has the marker.
  const [keyringModalOpen, setKeyringModalOpen] = useState(false);
  const [keyringSeenId, setKeyringSeenId] = useState<number | null>(null);

  // Newest history entry. Used to drive both the banner and the auto-popup.
  const latestHistory = useMemo(
    () => (history.length > 0 ? history[0] : null),
    [history]
  );
  const latestKeyringIssue = hasKeyringIssue(latestHistory?.log_output);
  const keyringExcerpt = latestKeyringIssue
    ? extractKeyringErrorExcerpt(latestHistory?.log_output)
    : '';

  // Auto-open the modal once per newly-arrived failing entry. We gate on the
  // history id so revisiting the page or refreshing doesn't keep re-opening
  // a popup the operator has already dismissed.
  useEffect(() => {
    if (
      latestHistory &&
      latestKeyringIssue &&
      latestHistory.id !== keyringSeenId
    ) {
      setKeyringModalOpen(true);
      setKeyringSeenId(latestHistory.id);
    }
  }, [latestHistory, latestKeyringIssue, keyringSeenId]);

  const handleScan = async () => {
    setScanning(true);
    setPatchMessage('');
    try {
      await triggerScanHost(host.id);
      await refresh();
      await refreshHistory();
    } finally {
      setScanning(false);
    }
  };

  const runPatch = async () => {
    setPendingAction(null);
    setPatching(true);
    setPatchMessage(`Applying updates to ${host.hostname}... This may take several minutes.`);
    try {
      await triggerPatchHost(host.id);
      // Post-patch scan: refresh package list so user sees updated state
      // immediately instead of stale pre-patch data.
      setPatchMessage(`Patching complete. Running post-patch scan...`);
      await triggerScanHost(host.id);
      await refresh();
      await refreshHistory();
      setPatchMessage('');
    } catch {
      setPatchMessage('Patching failed. Check the log below for details.');
      await refreshHistory();
    } finally {
      setPatching(false);
    }
  };

  const runReboot = async () => {
    setPendingAction(null);
    setRebooting(true);
    setPatchMessage(`Rebooting ${host.hostname}...`);
    try {
      await triggerReboot(host.id);
      setPatchMessage(`Reboot command sent to ${host.hostname}. Host will be offline briefly.`);
      await refresh();
    } finally {
      setRebooting(false);
    }
  };

  // Install packages apt kept back on the last patch. Runs the same patcher
  // path as a normal patch but with --with-new-pkgs so the held-back
  // metapackages (typically kernel) get pulled through. Usually leaves the
  // host wanting a reboot; the post-run scan will pick that up.
  const runInstallHeldBack = async () => {
    setPendingAction(null);
    setInstallingHeldBack(true);
    setPatchMessage(`Installing held-back updates on ${host.hostname}... This may take several minutes.`);
    try {
      await triggerInstallHeldBack(host.id);
      setPatchMessage('Install complete. Running post-install scan...');
      await triggerScanHost(host.id);
      await refresh();
      await refreshHistory();
      setPatchMessage('');
    } catch {
      setPatchMessage('Install failed. Check the patch log below for details.');
      await refreshHistory();
    } finally {
      setInstallingHeldBack(false);
    }
  };

  // Install /etc/sudoers.d/quietkeep-<user> on this host using a one-time
  // password. On success the backend re-probes so the refreshed host record
  // already reflects the new sudoers_ok state.
  const runFixSudoers = async (password: string) => {
    setPatchMessage('');
    const result = await fixSudoers(host.id, password);
    await refresh();
    if (result.success) {
      setSudoersModalOpen(false);
      setPatchMessage(
        result.sudoers_ok
          ? `Sudoers installed on ${host.hostname}. Patching and reboots are now enabled.`
          : `Sudoers installed on ${host.hostname} but the follow-up probe did not confirm. Try a manual scan.`
      );
    } else {
      // Throw so FixSudoersModal surfaces the message inline without closing.
      throw new Error(result.message || 'Install failed');
    }
  };

  const statusColor = !host.is_online ? 'bg-gray-600' : detail?.reboot_required ? 'bg-red-500' : (detail?.pending_updates ?? 0) > 0 ? 'bg-amber-500' : 'bg-emerald-500';
  const statusText = !host.is_online ? 'Offline' : detail?.reboot_required ? 'Reboot Required' : (detail?.pending_updates ?? 0) > 0 ? 'Updates Available' : 'Up to Date';
  const statusTextColor = !host.is_online ? 'text-gray-500' : detail?.reboot_required ? 'text-red-400' : (detail?.pending_updates ?? 0) > 0 ? 'text-amber-400' : 'text-emerald-400';

  // Sudoers status derived fields. Root users do not need a sudoers file;
  // the backend probe short-circuits to true for them, so we simply hide
  // the badge to avoid noise.
  const isRoot = host.username === 'root';
  const sudoersOk = detail?.sudoers_ok ?? host.sudoers_ok;
  const sudoersKnown = sudoersOk !== null && sudoersOk !== undefined;
  const sudoersBad = sudoersKnown && sudoersOk === false;

  // Held-back packages from the last patch run. Prefer the fresh detail
  // payload over the cached host prop so the card disappears immediately
  // after a successful install without waiting for a parent re-fetch.
  // Scope: only apt and proxmox hosts can end up with held-back packages
  // because kali uses dist-upgrade and pacman does a full upgrade already.
  const heldBack = detail?.held_back_packages ?? host.held_back_packages ?? [];
  const hasHeldBack =
    heldBack.length > 0 && (host.os_type === 'apt' || host.os_type === 'proxmox');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-gray-400 hover:text-gray-200 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          <span className="text-sm">Back to System Patches</span>
        </button>
        <div className="flex gap-2">
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 disabled:opacity-50 transition-colors"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Scan
          </button>
          {host.is_patch_target && (
            <button
              onClick={() => setPendingAction('patch')}
              disabled={patching || !detail || detail.pending_updates === 0}
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition-colors"
            >
              {patching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Patch
            </button>
          )}
          {host.is_patch_target && detail?.reboot_required && (
            <button
              onClick={() => setPendingAction('reboot')}
              disabled={rebooting}
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 transition-colors"
            >
              {rebooting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              Reboot
            </button>
          )}
          {!isRoot && sudoersBad && (
            <button
              onClick={() => setSudoersModalOpen(true)}
              title="Install /etc/sudoers.d/quietkeep-<user> so patch and reboot work without prompting for a password"
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-amber-600 hover:bg-amber-500 transition-colors"
            >
              <KeyRound className="h-4 w-4" />
              Fix Sudoers
            </button>
          )}
        </div>
      </div>

      {/* Progress Banner */}
      {patchMessage && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex items-center gap-3">
          {(patching || scanning || rebooting) && <Loader2 className="h-5 w-5 animate-spin text-blue-400 shrink-0" />}
          <p className="text-sm text-blue-300">{patchMessage}</p>
        </div>
      )}

      {/* Persistent banner: latest patch failed because the distro rotated
          its repository signing key. Stays visible until a subsequent patch
          succeeds (and therefore doesn't carry the marker). Click re-opens
          the recovery instructions. */}
      {latestKeyringIssue && (
        <button
          type="button"
          onClick={() => setKeyringModalOpen(true)}
          className="w-full text-left bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center gap-3 hover:bg-amber-500/15 transition-colors"
        >
          <KeyRound className="h-5 w-5 text-amber-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-amber-300 font-medium">
              Repository signing key rotated: manual keyring refresh needed
            </p>
            <p className="text-xs text-amber-200/70 mt-0.5">
              Last patch on {host.hostname} failed GPG verification. Click for
              secure recovery steps.
            </p>
          </div>
          <span className="text-xs text-amber-400 underline">View fix</span>
        </button>
      )}

      {/* Host Info - compact row with status indicator */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex items-center gap-4 px-5 py-4">
          <div className={`w-1.5 h-10 rounded-full ${statusColor}`} />
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold">{host.hostname}</h2>
              <span className={`text-xs font-medium ${statusTextColor}`}>{statusText}</span>
              {!host.is_patch_target && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 border border-gray-700 uppercase tracking-wider">
                  monitor only
                </span>
              )}
              {!isRoot && sudoersKnown && sudoersOk && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wider"
                  title="NOPASSWD sudoers rule is installed and working"
                >
                  <ShieldCheck className="h-3 w-3" />
                  sudoers ok
                </span>
              )}
              {!isRoot && sudoersBad && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wider"
                  title="Patching and reboots will fail. Click Fix Sudoers."
                >
                  <ShieldAlert className="h-3 w-3" />
                  sudoers needs fix
                </span>
              )}
              {!isRoot && !sudoersKnown && host.is_online && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-400 border border-gray-600/30 uppercase tracking-wider"
                  title="Sudoers not probed yet. Run a scan."
                >
                  <ShieldQuestion className="h-3 w-3" />
                  sudoers unknown
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
              <span className="font-mono">{host.ip_address}</span>
              <span>·</span>
              <span>{host.username}@</span>
              <span>·</span>
              <span>{host.os_type === 'apt' ? 'Debian/Ubuntu' : host.os_type === 'pacman' ? 'Arch' : host.os_type === 'proxmox' ? 'Proxmox' : host.os_type}</span>
              {host.last_scan && (
                <>
                  <span>·</span>
                  <span>Scanned {formatUTC(host.last_scan)}</span>
                </>
              )}
              {host.is_online && (detail?.last_boot_at ?? host.last_boot_at) && (
                <>
                  <span>·</span>
                  <span
                    className="font-mono"
                    title={`Last boot: ${formatUTC((detail?.last_boot_at ?? host.last_boot_at) as string)}`}
                  >
                    up {formatUptime(detail?.last_boot_at ?? host.last_boot_at)}
                  </span>
                </>
              )}
            </div>
          </div>
          {/* Quick stats */}
          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className={`text-lg font-bold ${(detail?.pending_updates ?? 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {detail?.pending_updates ?? 0}
              </p>
              <p className="text-[10px] text-gray-500">packages</p>
            </div>
            {detail?.reboot_required && (
              <div className="text-center">
                <RotateCw className="h-5 w-5 text-red-400 mx-auto" />
                <p className="text-[10px] text-red-400 mt-0.5">reboot</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Diagnostics card. Consolidates system-level health info in one
          place so operators can see kernel, uptime, sudoers, and reboot
          status without scanning multiple parts of the page. */}
      {host.is_online && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800">
            <Activity className="h-4 w-4 text-blue-400" />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Diagnostics
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 p-5">
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">OS</p>
              <p className="text-sm text-gray-300">
                {(detail?.os_pretty_name ?? host.os_pretty_name) || (host.os_type === 'apt' ? 'Debian/Ubuntu' : host.os_type === 'pacman' ? 'Arch' : host.os_type === 'proxmox' ? 'Proxmox' : host.os_type === 'kali' ? 'Kali' : host.os_type)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Kernel</p>
              <p className="text-sm font-mono text-gray-300">
                {(detail?.kernel_version ?? host.kernel_version) || <span className="text-gray-600">Unknown</span>}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Uptime</p>
              {(detail?.last_boot_at ?? host.last_boot_at) ? (
                <p
                  className="text-sm font-mono text-gray-300"
                  title={`Last boot: ${formatUTC((detail?.last_boot_at ?? host.last_boot_at) as string)}`}
                >
                  {formatUptime(detail?.last_boot_at ?? host.last_boot_at)}
                </p>
              ) : (
                <p className="text-sm text-gray-600">Unknown</p>
              )}
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Reboot</p>
              <p className={`text-sm ${detail?.reboot_required ? 'text-red-400' : 'text-emerald-400'}`}>
                {detail?.reboot_required ? 'Required' : 'Not required'}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Sudoers</p>
              {isRoot ? (
                <p className="text-sm text-gray-500">N/A (root)</p>
              ) : sudoersOk ? (
                <p className="text-sm text-emerald-400">OK</p>
              ) : sudoersBad ? (
                <p className="text-sm text-amber-400">Needs fix</p>
              ) : (
                <p className="text-sm text-gray-600">Not probed</p>
              )}
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Last Scan</p>
              <p className="text-sm text-gray-300">
                {host.last_scan ? formatUTC(host.last_scan) : <span className="text-gray-600">Never</span>}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Held-Back Packages card. Surfaces packages apt kept back on the
          last patch run and offers a dedicated one-click install. Absent
          when the list is empty (typical healthy state) or the host is
          kali/pacman (which already do full upgrades). */}
      {hasHeldBack && (
        <div className="bg-gray-900 border border-amber-500/30 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800">
            <Cpu className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
              Held-Back Updates
            </span>
            <span className="text-xs text-gray-600 ml-auto">{heldBack.length} package{heldBack.length === 1 ? '' : 's'}</span>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-sm text-gray-400">
              The last patch left these packages held back because they require
              installing new dependencies. This is typical for kernel updates on
              Ubuntu/Debian. Installing them usually triggers a reboot requirement.
            </p>
            <div className="flex flex-wrap gap-2">
              {heldBack.map((pkg) => (
                <span
                  key={pkg}
                  className="inline-flex items-center px-2 py-1 text-xs font-mono rounded bg-amber-500/10 text-amber-300 border border-amber-500/20"
                >
                  {pkg}
                </span>
              ))}
            </div>
            {host.is_patch_target && (
              <div className="flex justify-end pt-1">
                <button
                  onClick={() => setPendingAction('install-held-back')}
                  disabled={installingHeldBack}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 transition-colors"
                >
                  {installingHeldBack ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
                  Install Held-Back Updates
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Two-column: Packages + History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pending Packages */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800">
            <Package className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Pending Updates
            </span>
            <span className="text-xs text-gray-600 ml-auto">{detail?.packages.length ?? 0} packages</span>
          </div>
          <div className="p-5">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
              </div>
            ) : detail?.packages.length === 0 ? (
              <p className="text-gray-500 text-sm py-4 text-center">No pending updates</p>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-800">
                      <th className="pb-2 font-medium text-[11px] uppercase tracking-wider">Package</th>
                      <th className="pb-2 font-medium text-[11px] uppercase tracking-wider">Current</th>
                      <th className="pb-2 font-medium text-[11px] uppercase tracking-wider">Available</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {detail?.packages.map((pkg) => (
                      <tr key={pkg.id} className="hover:bg-gray-800/30">
                        <td className="py-1.5 font-mono text-xs">{pkg.package_name}</td>
                        <td className="py-1.5 font-mono text-xs text-gray-500">{pkg.current_version || '-'}</td>
                        <td className="py-1.5 font-mono text-xs text-emerald-400">{pkg.available_version || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Patch History */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800">
            <Clock className="h-4 w-4 text-purple-400" />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Patch History
            </span>
            <span className="text-xs text-gray-600 ml-auto">{history.length} entries</span>
          </div>
          <div className="p-3">
            {historyLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
              </div>
            ) : history.length === 0 ? (
              <p className="text-gray-500 text-sm py-4 text-center">No patch history</p>
            ) : (
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {history.map((h) => (
                  <div key={h.id} className="border border-gray-800/50 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setExpandedLog(expandedLog === h.id ? null : h.id)}
                      className="w-full flex items-center justify-between p-3 text-sm hover:bg-gray-800/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {expandedLog === h.id ? (
                          <ChevronDown className="h-4 w-4 text-gray-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-500" />
                        )}
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            h.status === 'success'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : h.status === 'partial'
                              ? 'bg-amber-500/10 text-amber-400'
                              : h.status === 'failed'
                              ? 'bg-red-500/10 text-red-400'
                              : h.status === 'running'
                              ? 'bg-blue-500/10 text-blue-400'
                              : 'bg-gray-500/10 text-gray-400'
                          }`}
                        >
                          {h.status}
                        </span>
                        <span className="text-gray-400 text-xs">{h.packages_updated} pkgs</span>
                        {h.log_output && (
                          <Terminal className="h-3 w-3 text-gray-600" />
                        )}
                      </div>
                      <span className="text-gray-600 text-xs">
                        {h.started_at ? formatUTC(h.started_at) : '-'}
                      </span>
                    </button>
                    {expandedLog === h.id && h.log_output && (
                      <div className="border-t border-gray-800/50 bg-gray-950 p-4 max-h-64 overflow-auto">
                        <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap break-all">{h.log_output}</pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation modals. Centered overlay replaces native window.confirm(). */}
      <ConfirmDialog
        open={pendingAction === 'patch'}
        title="Apply Pending Updates"
        message={<>Apply all pending updates to <span className="text-white font-medium">{host.hostname}</span>?</>}
        confirmLabel="Apply Updates"
        variant="primary"
        loading={patching}
        onConfirm={runPatch}
        onCancel={() => setPendingAction(null)}
      />
      <ConfirmDialog
        open={pendingAction === 'reboot'}
        title="Reboot Host"
        message={
          <>
            Reboot <span className="text-white font-medium">{host.hostname}</span>
            {' '}(<span className="font-mono">{host.ip_address}</span>)? The host will
            be temporarily unavailable.
          </>
        }
        confirmLabel="Reboot"
        variant="danger"
        loading={rebooting}
        onConfirm={runReboot}
        onCancel={() => setPendingAction(null)}
      />
      <ConfirmDialog
        open={pendingAction === 'install-held-back'}
        title="Install Held-Back Updates"
        message={
          <>
            Install {heldBack.length} held-back package{heldBack.length === 1 ? '' : 's'} on{' '}
            <span className="text-white font-medium">{host.hostname}</span>? This
            runs <span className="font-mono">apt-get upgrade --with-new-pkgs</span>,
            which pulls in the held-back versions without removing anything. A
            reboot is likely needed after install; QuietKeep will detect that on
            the post-install scan.
          </>
        }
        confirmLabel="Install"
        variant="warning"
        loading={installingHeldBack}
        onConfirm={runInstallHeldBack}
        onCancel={() => setPendingAction(null)}
      />
      <FixSudoersModal
        open={sudoersModalOpen}
        hostname={host.hostname}
        username={host.username}
        osType={host.os_type}
        onCancel={() => setSudoersModalOpen(false)}
        onConfirm={runFixSudoers}
      />
      <KeyringHelpModal
        open={keyringModalOpen}
        hostname={host.hostname}
        ipAddress={host.ip_address}
        username={host.username}
        osType={host.os_type}
        logExcerpt={keyringExcerpt}
        onClose={() => setKeyringModalOpen(false)}
      />
    </div>
  );
}
