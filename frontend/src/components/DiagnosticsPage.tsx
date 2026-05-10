// QuietKeep: DiagnosticsPage.tsx
// Fleet-wide diagnostics view. Shows all hosts in a single table with system
// health columns (OS, kernel, uptime, reboot, sudoers, last scan) so an
// experienced operator can check everything at a glance without drilling into
// individual host detail pages.
// Author: QuietWire (Dennis Ayotte)

import { useState } from 'react';
import { Activity, RefreshCw, Loader2, ChevronUp, ChevronDown } from 'lucide-react';
import { useHosts, triggerScanAll } from '../hooks/useApi';
import { formatUTC, formatUptime } from '../utils/formatDate';
import type { Host } from '../types';

type SortKey = 'hostname' | 'os' | 'kernel' | 'disk' | 'uptime' | 'reboot' | 'sudoers' | 'last_scan';
type SortDir = 'asc' | 'desc';

// Fallback OS label when os_pretty_name has not been probed yet.
function osLabel(host: Host): string {
  if (host.os_pretty_name) return host.os_pretty_name;
  switch (host.os_type) {
    case 'apt': return 'Debian/Ubuntu';
    case 'pacman': return 'Arch';
    case 'proxmox': return 'Proxmox';
    case 'kali': return 'Kali';
    default: return host.os_type;
  }
}

// Color class for disk usage percentage.
function diskColor(pct: number | null): string {
  if (pct === null) return 'text-gray-600';
  if (pct >= 90) return 'text-red-400';
  if (pct >= 70) return 'text-amber-400';
  return 'text-emerald-400';
}

// Sort comparator value for a given key.
function sortValue(host: Host, key: SortKey): string | number {
  switch (key) {
    case 'hostname': return host.hostname.toLowerCase();
    case 'os': return osLabel(host).toLowerCase();
    case 'kernel': return (host.kernel_version ?? '').toLowerCase();
    case 'disk': return host.disk_usage_percent ?? -1;
    case 'uptime': return host.last_boot_at ? new Date(host.last_boot_at).getTime() : 0;
    case 'reboot': return host.reboot_required ? 1 : 0;
    case 'sudoers': return host.sudoers_ok === true ? 0 : host.sudoers_ok === false ? 2 : 1;
    case 'last_scan': return host.last_scan ? new Date(host.last_scan).getTime() : 0;
    default: return '';
  }
}

export default function DiagnosticsPage() {
  const { hosts, loading, refresh } = useHosts();
  const [scanning, setScanning] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('hostname');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleScanAll = async () => {
    setScanning(true);
    try {
      await triggerScanAll();
      await refresh();
    } finally {
      setScanning(false);
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedHosts = [...hosts].sort((a, b) => {
    const va = sortValue(a, sortKey);
    const vb = sortValue(b, sortKey);
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortDir === 'asc'
      ? <ChevronUp className="h-3 w-3 inline ml-0.5" />
      : <ChevronDown className="h-3 w-3 inline ml-0.5" />;
  };

  const thClass = "pb-2 font-medium text-[11px] uppercase tracking-wider cursor-pointer hover:text-gray-300 transition-colors select-none";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Diagnostics</h2>
          <p className="text-xs text-gray-500 mt-1">
            Fleet-wide system health at a glance
          </p>
        </div>
        <button
          onClick={handleScanAll}
          disabled={scanning}
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 disabled:opacity-50 transition-colors"
        >
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Scan All
        </button>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800">
          <Activity className="h-4 w-4 text-blue-400" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            All Hosts
          </span>
          <span className="text-xs text-gray-600 ml-auto">{hosts.length} hosts</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
          </div>
        ) : hosts.length === 0 ? (
          <p className="text-gray-500 text-sm py-12 text-center">No hosts configured</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-800">
                  <th className={`pl-5 ${thClass}`} onClick={() => toggleSort('hostname')}>
                    Host <SortIcon col="hostname" />
                  </th>
                  <th className={thClass} onClick={() => toggleSort('os')}>
                    OS <SortIcon col="os" />
                  </th>
                  <th className={thClass} onClick={() => toggleSort('kernel')}>
                    Kernel <SortIcon col="kernel" />
                  </th>
                  <th className={thClass} onClick={() => toggleSort('disk')}>
                    Disk <SortIcon col="disk" />
                  </th>
                  <th className={thClass} onClick={() => toggleSort('uptime')}>
                    Uptime <SortIcon col="uptime" />
                  </th>
                  <th className={thClass} onClick={() => toggleSort('reboot')}>
                    Reboot <SortIcon col="reboot" />
                  </th>
                  <th className={thClass} onClick={() => toggleSort('sudoers')}>
                    Sudoers <SortIcon col="sudoers" />
                  </th>
                  <th className={`pr-5 ${thClass}`} onClick={() => toggleSort('last_scan')}>
                    Last Scan <SortIcon col="last_scan" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {sortedHosts.map((host) => (
                  <tr key={host.id} className="hover:bg-gray-800/30 transition-colors">
                    {/* Hostname + IP */}
                    <td className="pl-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${host.is_online ? 'bg-emerald-500' : 'bg-gray-600'}`} />
                        <div>
                          <p className="text-sm font-medium text-gray-200">{host.hostname}</p>
                          <p className="text-[10px] text-gray-600 font-mono">{host.ip_address}</p>
                        </div>
                      </div>
                    </td>
                    {/* OS */}
                    <td className="py-2.5 text-xs text-gray-400">
                      {osLabel(host)}
                    </td>
                    {/* Kernel */}
                    <td className="py-2.5 text-xs font-mono text-gray-400">
                      {host.kernel_version || <span className="text-gray-600">-</span>}
                    </td>
                    {/* Disk */}
                    <td className={`py-2.5 text-xs font-mono ${diskColor(host.disk_usage_percent)}`}>
                      {host.disk_usage_percent !== null ? `${host.disk_usage_percent}%` : <span className="text-gray-600">-</span>}
                    </td>
                    {/* Uptime */}
                    <td className="py-2.5 text-xs font-mono text-gray-400">
                      {host.is_online && host.last_boot_at ? (
                        <span title={`Last boot: ${formatUTC(host.last_boot_at)}`}>
                          {formatUptime(host.last_boot_at)}
                        </span>
                      ) : (
                        <span className="text-gray-600">-</span>
                      )}
                    </td>
                    {/* Reboot */}
                    <td className="py-2.5 text-xs">
                      {host.reboot_required ? (
                        <span className="text-red-400">Required</span>
                      ) : host.is_online ? (
                        <span className="text-emerald-400">No</span>
                      ) : (
                        <span className="text-gray-600">-</span>
                      )}
                    </td>
                    {/* Sudoers */}
                    <td className="py-2.5 text-xs">
                      {host.username === 'root' ? (
                        <span className="text-gray-500">N/A</span>
                      ) : host.sudoers_ok === true ? (
                        <span className="text-emerald-400">OK</span>
                      ) : host.sudoers_ok === false ? (
                        <span className="text-amber-400">Needs fix</span>
                      ) : (
                        <span className="text-gray-600">Unknown</span>
                      )}
                    </td>
                    {/* Last Scan */}
                    <td className="pr-5 py-2.5 text-xs text-gray-500">
                      {host.last_scan ? formatUTC(host.last_scan) : <span className="text-gray-600">Never</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
