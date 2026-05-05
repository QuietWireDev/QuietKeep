// QuietKeep: HomePage.tsx
// Overview dashboard (default landing page). Shows fleet health ring, metric tiles,
// segmented status bar, host list with OS filters, and quick-nav panels.
// "Scan All" triggers both system and Docker scans in parallel.
// Author: QuietWire (Dennis Ayotte)

import { Monitor, Package, Container, ArrowRight, RefreshCw, Loader2, RotateCw } from 'lucide-react';
import { useDashboard, useDockerDashboard, useHosts, triggerScanAll, triggerDockerScanAll, isScanRunning, getActiveScanPromise } from '../hooks/useApi';
import { formatUTC, formatUptime } from '../utils/formatDate';
import { useState, useEffect } from 'react';
import type { Host } from '../types';

interface Props {
  onNavigate: (tab: string) => void;
}

function hostStatus(host: Host): 'offline' | 'reboot' | 'updates' | 'current' {
  if (!host.is_online) return 'offline';
  if (host.reboot_required) return 'reboot';
  if (host.pending_updates > 0) return 'updates';
  return 'current';
}

const statusConfig = {
  current: { color: 'bg-emerald-500', ring: '#10b981', text: 'text-emerald-400', label: 'Up to date', dot: 'bg-emerald-400', tile: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/20' },
  updates: { color: 'bg-amber-500', ring: '#f59e0b', text: 'text-amber-400', label: 'Need Updates', dot: 'bg-amber-400', tile: 'from-amber-500/20 to-amber-500/5 border-amber-500/20' },
  reboot:  { color: 'bg-red-500', ring: '#ef4444', text: 'text-red-400', label: 'Need Reboot', dot: 'bg-red-400', tile: 'from-red-500/20 to-red-500/5 border-red-500/20' },
  offline: { color: 'bg-gray-600', ring: '#4b5563', text: 'text-gray-500', label: 'Offline', dot: 'bg-gray-500', tile: 'from-gray-500/20 to-gray-500/5 border-gray-600/20' },
};

function FleetHealthRing({ grouped, total }: { grouped: Record<string, Host[]>; total: number }) {
  if (total === 0) return null;
  const segments = [
    { key: 'current', count: grouped.current.length },
    { key: 'updates', count: grouped.updates.length },
    { key: 'reboot', count: grouped.reboot.length },
    { key: 'offline', count: grouped.offline.length },
  ];

  const radius = 52;
  const stroke = 10;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const healthyPct = total > 0 ? Math.round((grouped.current.length / total) * 100) : 0;

  return (
    <div className="flex items-center gap-6">
      <div className="relative w-32 h-32 flex-shrink-0">
        <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
          {segments.map(seg => {
            const pct = seg.count / total;
            const dashLength = pct * circumference;
            const cfg = statusConfig[seg.key as keyof typeof statusConfig];
            const el = (
              <circle
                key={seg.key}
                cx="64" cy="64" r={radius}
                fill="none"
                stroke={cfg.ring}
                strokeWidth={stroke}
                strokeDasharray={`${dashLength} ${circumference - dashLength}`}
                strokeDashoffset={-offset}
                strokeLinecap="round"
                className="transition-all duration-500"
              />
            );
            offset += dashLength;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-emerald-400">{healthyPct}%</span>
          <span className="text-[10px] text-gray-500">healthy</span>
        </div>
      </div>
      <div className="space-y-2">
        {segments.filter(s => s.count > 0).map(seg => {
          const cfg = statusConfig[seg.key as keyof typeof statusConfig];
          return (
            <div key={seg.key} className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-sm ${cfg.dot}`} />
              <span className="text-xs text-gray-400 w-24">{cfg.label}</span>
              <span className={`text-sm font-bold ${cfg.text}`}>{seg.count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SegmentedBar({ grouped, total }: { grouped: Record<string, Host[]>; total: number }) {
  if (total === 0) return null;
  const segments = [
    { key: 'current', count: grouped.current.length },
    { key: 'updates', count: grouped.updates.length },
    { key: 'reboot', count: grouped.reboot.length },
    { key: 'offline', count: grouped.offline.length },
  ];

  return (
    <div className="flex h-2 rounded-full overflow-hidden bg-gray-800">
      {segments.map(seg => {
        if (seg.count === 0) return null;
        const cfg = statusConfig[seg.key as keyof typeof statusConfig];
        return (
          <div
            key={seg.key}
            className={`${cfg.color} transition-all duration-500`}
            style={{ width: `${(seg.count / total) * 100}%` }}
          />
        );
      })}
    </div>
  );
}

export default function HomePage({ onNavigate }: Props) {
  const { data: patchSummary, loading: patchLoading, refresh: refreshPatch } = useDashboard();
  const { data: dockerSummary, loading: dockerLoading, refresh: refreshDocker } = useDockerDashboard();
  const { hosts, refresh: refreshHosts } = useHosts();
  const [scanning, setScanning] = useState(() => isScanRunning());

  // If an auto-scan was triggered (e.g. from wizard), pick it up on mount
  useEffect(() => {
    const active = getActiveScanPromise();
    if (active) {
      setScanning(true);
      active
        .then(() => Promise.all([refreshPatch(), refreshDocker(), refreshHosts()]))
        .finally(() => setScanning(false));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [osFilter, setOsFilter] = useState<string>('all');

  const loading = patchLoading || dockerLoading;

  const handleScanAll = async () => {
    setScanning(true);
    try {
      await Promise.all([triggerScanAll(), triggerDockerScanAll()]);
      await Promise.all([refreshPatch(), refreshDocker(), refreshHosts()]);
    } finally {
      setScanning(false);
    }
  };

  const hasData = patchSummary && (patchSummary.total_hosts > 0 || hosts.length > 0);

  // Group hosts by severity for the health ring and status bar.
  // Order matters: reboot > updates > current > offline (most urgent first).
  const grouped = {
    reboot: hosts.filter(h => h.is_online && h.reboot_required),
    updates: hosts.filter(h => h.is_online && !h.reboot_required && h.pending_updates > 0),
    current: hosts.filter(h => h.is_online && !h.reboot_required && h.pending_updates === 0),
    offline: hosts.filter(h => !h.is_online),
  };

  const totalHosts = hosts.length;

  // Unique OS types from hosts, ordered: apt first, then pacman, kali, proxmox, rest
  const osOrder = ['apt', 'kali', 'pacman', 'proxmox'];
  const osTypes = [...new Set(hosts.map(h => h.os_type))].sort((a, b) => {
    const ai = osOrder.indexOf(a);
    const bi = osOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const osLabel = (t: string) => t === 'apt' ? 'Debian/Ubuntu' : t === 'pacman' ? 'Arch' : t === 'kali' ? 'Kali' : t === 'proxmox' ? 'Proxmox' : t;

  return (
    <div className="space-y-5">
      {/* Scan in progress banner */}
      {scanning && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 flex items-center gap-3">
          <Loader2 className="h-5 w-5 text-emerald-400 animate-spin flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-emerald-300">Scanning all hosts...</p>
            <p className="text-xs text-gray-400">This may take a minute. Results will appear automatically when complete.</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Overview</h2>
        <button
          onClick={handleScanAll}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition-colors font-medium text-sm"
        >
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {scanning ? 'Scanning...' : 'Scan All'}
        </button>
      </div>

      {/* Empty state */}
      {!loading && !hasData && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center space-y-4">
          <Monitor className="h-12 w-12 mx-auto text-gray-600" />
          <div>
            <h3 className="text-lg font-semibold mb-1">No hosts configured yet</h3>
            <p className="text-sm text-gray-500">Add your first host, then run a scan to see your fleet status here.</p>
          </div>
          <button
            onClick={() => onNavigate('settings')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium text-sm transition-colors"
          >
            Go to Settings <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main dashboard */}
      {(loading || hasData) && (
        <>
          {loading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl h-28 animate-pulse" />
                ))}
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl h-64 animate-pulse" />
            </div>
          ) : (
            <>
              {/* Row 1: Fleet health ring + colored metric tiles */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Fleet Health donut */}
                <div className="lg:col-span-4 bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Fleet Health</h3>
                  <FleetHealthRing grouped={grouped} total={totalHosts} />
                </div>

                {/* Metric tiles */}
                <div className="lg:col-span-8 grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Total Hosts */}
                  <div className="bg-gradient-to-b from-blue-500/15 to-blue-500/5 border border-blue-500/20 rounded-xl p-4 flex flex-col justify-between">
                    <span className="text-[11px] text-blue-300/70 font-medium uppercase tracking-wider">Hosts</span>
                    <div className="mt-2">
                      <span className="text-3xl font-bold text-blue-300">{patchSummary?.total_hosts ?? 0}</span>
                    </div>
                    <span className="text-[10px] text-blue-400/50 mt-1">{patchSummary?.hosts_online ?? 0} online</span>
                  </div>

                  {/* Pending Packages */}
                  <div className="bg-gradient-to-b from-purple-500/15 to-purple-500/5 border border-purple-500/20 rounded-xl p-4 flex flex-col justify-between">
                    <span className="text-[11px] text-purple-300/70 font-medium uppercase tracking-wider">Packages</span>
                    <div className="mt-2">
                      <span className="text-3xl font-bold text-purple-300">{patchSummary?.total_pending_packages ?? 0}</span>
                    </div>
                    <span className="text-[10px] text-purple-400/50 mt-1">pending updates</span>
                  </div>

                  {/* Docker Stacks */}
                  <div className="bg-gradient-to-b from-cyan-500/15 to-cyan-500/5 border border-cyan-500/20 rounded-xl p-4 flex flex-col justify-between">
                    <span className="text-[11px] text-cyan-300/70 font-medium uppercase tracking-wider">Docker</span>
                    <div className="mt-2">
                      <span className="text-3xl font-bold text-cyan-300">{dockerSummary?.total_stacks ?? 0}</span>
                    </div>
                    <span className="text-[10px] text-cyan-400/50 mt-1">{dockerSummary?.stacks_with_updates ?? 0} need updates</span>
                  </div>

                  {/* Need Attention */}
                  <div className={`bg-gradient-to-b rounded-xl p-4 flex flex-col justify-between ${
                    (patchSummary?.hosts_needing_reboot ?? 0) > 0
                      ? 'from-red-500/15 to-red-500/5 border border-red-500/20'
                      : (patchSummary?.hosts_with_updates ?? 0) > 0
                        ? 'from-amber-500/15 to-amber-500/5 border border-amber-500/20'
                        : 'from-emerald-500/15 to-emerald-500/5 border border-emerald-500/20'
                  }`}>
                    <span className="text-[11px] text-gray-300/70 font-medium uppercase tracking-wider">Attention</span>
                    <div className="mt-2">
                      <span className={`text-3xl font-bold ${
                        (patchSummary?.hosts_needing_reboot ?? 0) > 0 ? 'text-red-300'
                          : (patchSummary?.hosts_with_updates ?? 0) > 0 ? 'text-amber-300'
                          : 'text-emerald-300'
                      }`}>
                        {(patchSummary?.hosts_with_updates ?? 0) + (patchSummary?.hosts_needing_reboot ?? 0)}
                      </span>
                    </div>
                    <span className="text-[10px] text-gray-400/50 mt-1">
                      {(patchSummary?.hosts_needing_reboot ?? 0) > 0
                        ? `${patchSummary?.hosts_needing_reboot} reboot required`
                        : 'hosts need action'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Row 2: Segmented status bar */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Host Distribution</span>
                  <div className="flex items-center gap-4">
                    {(['current', 'updates', 'reboot', 'offline'] as const).map(status => (
                      <div key={status} className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-sm ${statusConfig[status].dot}`} />
                        <span className="text-[10px] text-gray-500">{statusConfig[status].label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <SegmentedBar grouped={grouped} total={totalHosts} />
              </div>

              {/* Row 3: Host list + panels side by side */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Host list - takes more space */}
                <div className="lg:col-span-8 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-1">
                    <button
                      onClick={() => setOsFilter('all')}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                        osFilter === 'all'
                          ? 'bg-gray-700 text-white'
                          : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                      }`}
                    >
                      All Hosts
                    </button>
                    {osTypes.map(t => (
                      <button
                        key={t}
                        onClick={() => setOsFilter(osFilter === t ? 'all' : t)}
                        className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                          osFilter === t
                            ? 'bg-gray-700 text-white'
                            : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                        }`}
                      >
                        {osLabel(t)}
                      </button>
                    ))}
                  </div>
                  <div className="divide-y divide-gray-800/50">
                    {[...grouped.reboot, ...grouped.updates, ...grouped.current, ...grouped.offline]
                      .filter(host => osFilter === 'all' || host.os_type === osFilter)
                      .map(host => {
                      const status = hostStatus(host);
                      const cfg = statusConfig[status];
                      return (
                        <button
                          key={host.id}
                          onClick={() => onNavigate('patches')}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/40 transition-colors text-left group"
                        >
                          <div className={`w-1 h-6 rounded-full ${cfg.color}`} />
                          <span className="text-sm font-medium w-36 truncate group-hover:text-white transition-colors">
                            {host.hostname}
                          </span>
                          <span className="text-xs text-gray-500 w-28 font-mono">{host.ip_address}</span>
                          {/* Fixed-width wrapper so the uptime pill that follows
                              lines up vertically across all rows, regardless of
                              the varying OS-name widths (Arch vs Debian/Ubuntu). */}
                          <div className="w-28 shrink-0">
                            <span className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                              {host.os_type === 'apt' ? 'Debian/Ubuntu' : host.os_type === 'pacman' ? 'Arch' : host.os_type === 'proxmox' ? 'Proxmox' : host.os_type}
                            </span>
                          </div>
                          <div className="w-20 shrink-0">
                            {host.is_online && host.last_boot_at && (
                              <span
                                className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700 font-mono"
                                title={`Last boot: ${formatUTC(host.last_boot_at)}`}
                              >
                                up {formatUptime(host.last_boot_at)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 ml-auto">
                            {host.reboot_required && (
                              <span className="flex items-center gap-1 text-[11px] text-red-400">
                                <RotateCw className="h-3 w-3" /> Reboot
                              </span>
                            )}
                            {host.pending_updates > 0 && (
                              <span className="text-[11px] text-amber-400 font-medium">
                                {host.pending_updates} pkg{host.pending_updates !== 1 ? 's' : ''}
                              </span>
                            )}
                            {host.is_online && host.pending_updates === 0 && !host.reboot_required && (
                              <span className="text-[11px] text-emerald-400/70">current</span>
                            )}
                            {!host.is_online && (
                              <span className="text-[11px] text-gray-600">offline</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Right column: quick action panels */}
                <div className="lg:col-span-4 space-y-4">
                  {/* System Patches panel */}
                  <button
                    onClick={() => onNavigate('patches')}
                    className="w-full bg-gray-900 border border-gray-800 rounded-xl p-5 text-left hover:border-gray-700 transition-colors group"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-blue-400" />
                        <span className="font-semibold text-sm">System Patches</span>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-gray-600 group-hover:text-blue-400 transition-colors" />
                    </div>
                    {patchSummary ? (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Pending</span>
                          <span className="font-bold">{patchSummary.total_pending_packages}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Need updates</span>
                          <span className={`font-bold ${patchSummary.hosts_with_updates > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {patchSummary.hosts_with_updates}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Need reboot</span>
                          <span className={`font-bold ${patchSummary.hosts_needing_reboot > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                            {patchSummary.hosts_needing_reboot}
                          </span>
                        </div>
                        {patchSummary.last_scan && (
                          <p className="text-[10px] text-gray-600 pt-2 border-t border-gray-800">
                            Scanned {formatUTC(patchSummary.last_scan)}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-600">No data yet</p>
                    )}
                  </button>

                  {/* Docker panel */}
                  <button
                    onClick={() => onNavigate('docker')}
                    className="w-full bg-gray-900 border border-gray-800 rounded-xl p-5 text-left hover:border-gray-700 transition-colors group"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Container className="h-4 w-4 text-purple-400" />
                        <span className="font-semibold text-sm">Docker Stacks</span>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-gray-600 group-hover:text-purple-400 transition-colors" />
                    </div>
                    {dockerSummary ? (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Total stacks</span>
                          <span className="font-bold">{dockerSummary.total_stacks}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Docker hosts</span>
                          <span className="font-bold">{dockerSummary.docker_hosts}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Need updates</span>
                          <span className={`font-bold ${dockerSummary.stacks_with_updates > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {dockerSummary.stacks_with_updates}
                          </span>
                        </div>
                        {dockerSummary.last_scan && (
                          <p className="text-[10px] text-gray-600 pt-2 border-t border-gray-800">
                            Scanned {formatUTC(dockerSummary.last_scan)}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-600">No data yet</p>
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
