// QuietKeep: Dashboard.tsx
// System Patches tab. Shows summary metric tiles (clickable filters), OS filter
// tabs, and a sortable host list. Clicking a host opens HostDetail.
// Hosts are sorted by severity: reboot → updates → current → offline.
// Author: QuietWire (Dennis Ayotte)

import { useState, useMemo } from 'react';
import { RefreshCw, Loader2, RotateCw, Package, Monitor, AlertTriangle } from 'lucide-react';
import type { Host } from '../types';
import { useDashboard, useHosts, triggerScanAll } from '../hooks/useApi';
import { formatUTC } from '../utils/formatDate';
import HostDetail from './HostDetail';

type StatusFilter = 'all' | 'online' | 'updates' | 'reboot';

const osOrder = ['apt', 'kali', 'pacman', 'proxmox'];
const osLabel = (t: string) => t === 'apt' ? 'Debian/Ubuntu' : t === 'pacman' ? 'Arch' : t === 'kali' ? 'Kali' : t === 'proxmox' ? 'Proxmox' : t;

function hostStatusKey(host: Host): 'offline' | 'reboot' | 'updates' | 'current' {
  if (!host.is_online) return 'offline';
  if (host.reboot_required) return 'reboot';
  if (host.pending_updates > 0) return 'updates';
  return 'current';
}

const statusStyles = {
  current: { color: 'bg-emerald-500', text: 'text-emerald-400' },
  updates: { color: 'bg-amber-500', text: 'text-amber-400' },
  reboot:  { color: 'bg-red-500', text: 'text-red-400' },
  offline: { color: 'bg-gray-600', text: 'text-gray-500' },
};

export default function Dashboard() {
  const { data: summary, loading: summaryLoading, refresh: refreshSummary } = useDashboard();
  const { hosts, loading: hostsLoading, refresh: refreshHosts } = useHosts();
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [scanning, setScanning] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [osFilter, setOsFilter] = useState<string>('all');

  const loading = summaryLoading || hostsLoading;

  const osTypes = useMemo(() =>
    [...new Set(hosts.map(h => h.os_type))].sort((a, b) => {
      const ai = osOrder.indexOf(a);
      const bi = osOrder.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }), [hosts]);

  const filteredHosts = useMemo(() => {
    let result = hosts;
    if (statusFilter === 'online') result = result.filter(h => h.is_online);
    else if (statusFilter === 'updates') result = result.filter(h => h.pending_updates > 0);
    else if (statusFilter === 'reboot') result = result.filter(h => h.reboot_required);
    if (osFilter !== 'all') result = result.filter(h => h.os_type === osFilter);
    // Sort by severity: reboot → updates → current → offline
    return [...result].sort((a, b) => {
      const order = { reboot: 0, updates: 1, current: 2, offline: 3 };
      return order[hostStatusKey(a)] - order[hostStatusKey(b)];
    });
  }, [hosts, statusFilter, osFilter]);

  const handleScanAll = async () => {
    setScanning(true);
    try {
      await triggerScanAll();
      await refreshSummary();
      await refreshHosts();
    } finally {
      setScanning(false);
    }
  };

  if (selectedHost) {
    return (
      <HostDetail
        host={selectedHost}
        onBack={() => {
          setSelectedHost(null);
          refreshSummary();
          refreshHosts();
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">System Patches</h2>
          {summary?.last_scan && (
            <p className="text-xs text-gray-500 mt-1">Last scan: {formatUTC(summary.last_scan)}</p>
          )}
        </div>
        <button
          onClick={handleScanAll}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition-colors font-medium text-sm"
        >
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {scanning ? 'Scanning...' : 'Scan All Hosts'}
        </button>
      </div>

      {/* Metric tiles */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl h-24 animate-pulse" />
          ))}
        </div>
      ) : summary && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <button
            onClick={() => setStatusFilter(statusFilter === 'all' ? 'all' : 'all')}
            className={`bg-gradient-to-b from-blue-500/15 to-blue-500/5 border rounded-xl p-4 text-left transition-all ${
              statusFilter === 'all' ? 'border-blue-400/50 ring-1 ring-blue-400/20' : 'border-blue-500/20 hover:border-blue-400/30'
            }`}
          >
            <Monitor className="h-4 w-4 text-blue-400 mb-2" />
            <p className="text-2xl font-bold text-blue-300">{summary.total_hosts}</p>
            <p className="text-[10px] text-blue-400/50">total hosts</p>
          </button>

          <button
            onClick={() => setStatusFilter(statusFilter === 'online' ? 'all' : 'online')}
            className={`bg-gradient-to-b from-emerald-500/15 to-emerald-500/5 border rounded-xl p-4 text-left transition-all ${
              statusFilter === 'online' ? 'border-emerald-400/50 ring-1 ring-emerald-400/20' : 'border-emerald-500/20 hover:border-emerald-400/30'
            }`}
          >
            <div className="w-2 h-2 rounded-full bg-emerald-400 mb-2" />
            <p className="text-2xl font-bold text-emerald-300">{summary.hosts_online}</p>
            <p className="text-[10px] text-emerald-400/50">online</p>
          </button>

          <button
            onClick={() => setStatusFilter(statusFilter === 'updates' ? 'all' : 'updates')}
            className={`bg-gradient-to-b from-amber-500/15 to-amber-500/5 border rounded-xl p-4 text-left transition-all ${
              statusFilter === 'updates' ? 'border-amber-400/50 ring-1 ring-amber-400/20' : 'border-amber-500/20 hover:border-amber-400/30'
            }`}
          >
            <AlertTriangle className="h-4 w-4 text-amber-400 mb-2" />
            <p className="text-2xl font-bold text-amber-300">{summary.hosts_with_updates}</p>
            <p className="text-[10px] text-amber-400/50">need updates</p>
          </button>

          <button
            onClick={() => setStatusFilter(statusFilter === 'reboot' ? 'all' : 'reboot')}
            className={`bg-gradient-to-b from-red-500/15 to-red-500/5 border rounded-xl p-4 text-left transition-all ${
              statusFilter === 'reboot' ? 'border-red-400/50 ring-1 ring-red-400/20' : 'border-red-500/20 hover:border-red-400/30'
            }`}
          >
            <RotateCw className="h-4 w-4 text-red-400 mb-2" />
            <p className="text-2xl font-bold text-red-300">{summary.hosts_needing_reboot}</p>
            <p className="text-[10px] text-red-400/50">need reboot</p>
          </button>

          <div className="bg-gradient-to-b from-purple-500/15 to-purple-500/5 border border-purple-500/20 rounded-xl p-4">
            <Package className="h-4 w-4 text-purple-400 mb-2" />
            <p className="text-2xl font-bold text-purple-300">{summary.total_pending_packages}</p>
            <p className="text-[10px] text-purple-400/50">pending packages</p>
          </div>
        </div>
      )}

      {/* Host list */}
      {!loading && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {/* Filter tabs */}
          <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setOsFilter('all')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                osFilter === 'all' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
              }`}
            >
              All Hosts
            </button>
            {osTypes.map(t => (
              <button
                key={t}
                onClick={() => setOsFilter(osFilter === t ? 'all' : t)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  osFilter === t ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                {osLabel(t)}
              </button>
            ))}
            {(statusFilter !== 'all' || osFilter !== 'all') && (
              <button
                onClick={() => { setStatusFilter('all'); setOsFilter('all'); }}
                className="ml-auto text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Host rows */}
          <div className="divide-y divide-gray-800/50">
            {filteredHosts.length === 0 ? (
              <p className="text-gray-500 text-sm py-8 text-center">No hosts match the current filters</p>
            ) : (
              filteredHosts.map(host => {
                const status = hostStatusKey(host);
                const cfg = statusStyles[status];
                return (
                  <button
                    key={host.id}
                    onClick={() => setSelectedHost(host)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/40 transition-colors text-left group"
                  >
                    <div className={`w-1 h-6 rounded-full ${cfg.color}`} />
                    <span className="text-sm font-medium w-36 truncate group-hover:text-white transition-colors">
                      {host.hostname}
                    </span>
                    <span className="text-xs text-gray-500 w-28 font-mono">{host.ip_address}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                      {osLabel(host.os_type)}
                    </span>
                    {!host.is_patch_target && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 border border-gray-700 uppercase tracking-wider">
                        monitor
                      </span>
                    )}
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
                    <span className="text-[10px] text-gray-600 w-36 text-right">
                      {host.last_scan ? formatUTC(host.last_scan) : 'Never'}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
