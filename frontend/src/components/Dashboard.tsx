// QuietKeep: Dashboard.tsx
// System Patches tab. Shows summary metric tiles (clickable filters), OS filter
// tabs, and a sortable host list. Clicking a host opens HostDetail.
// Hosts are sorted by severity: reboot → updates → current → offline.
// Author: QuietWire (Dennis Ayotte)

import { useState, useMemo, useEffect } from 'react';
import { RefreshCw, Loader2, RotateCw, Package, Monitor, AlertTriangle, Download, Play, CheckCircle, XCircle, AlertOctagon } from 'lucide-react';
import type { Host } from '../types';
import { useDashboard, useHosts, useTags, triggerScanAll, triggerPatchAll } from '../hooks/useApi';
import type { BulkPatchResult } from '../hooks/useApi';
import ConfirmDialog from './ConfirmDialog';
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

interface DashboardProps {
  initialFilter?: string;
  onFilterConsumed?: () => void;
}

export default function Dashboard({ initialFilter, onFilterConsumed }: DashboardProps = {}) {
  const { data: summary, loading: summaryLoading, refresh: refreshSummary } = useDashboard();
  const { hosts, loading: hostsLoading, refresh: refreshHosts } = useHosts();
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [scanning, setScanning] = useState(false);
  const [patching, setPatching] = useState(false);
  const [showPatchConfirm, setShowPatchConfirm] = useState(false);
  const [patchResults, setPatchResults] = useState<BulkPatchResult[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    if (initialFilter && !initialFilter.startsWith('tag:')) return (initialFilter as StatusFilter);
    return 'all';
  });
  const [osFilter, setOsFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<number | 'all'>(() => {
    if (initialFilter?.startsWith('tag:')) return parseInt(initialFilter.slice(4), 10);
    return 'all';
  });
  const { tags } = useTags();

  // Consume the initial filter so it doesn't persist on subsequent tab switches
  useEffect(() => {
    if (initialFilter) {
      if (initialFilter.startsWith('tag:')) {
        setTagFilter(parseInt(initialFilter.slice(4), 10));
        setStatusFilter('all');
      } else {
        setStatusFilter((initialFilter as StatusFilter) || 'all');
        setTagFilter('all');
      }
      onFilterConsumed?.();
    }
  }, [initialFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (tagFilter !== 'all') result = result.filter(h => h.tags?.some(t => t.id === tagFilter));
    // Sort by severity: reboot → updates → current → offline
    return [...result].sort((a, b) => {
      const order = { reboot: 0, updates: 1, current: 2, offline: 3 };
      return order[hostStatusKey(a)] - order[hostStatusKey(b)];
    });
  }, [hosts, statusFilter, osFilter, tagFilter]);

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

  const handlePatchAll = async () => {
    setShowPatchConfirm(false);
    setPatching(true);
    setPatchResults(null);
    try {
      const response = await triggerPatchAll();
      setPatchResults(response.results);
      await refreshSummary();
      await refreshHosts();
    } catch {
      setPatchResults([{ host_id: 0, hostname: 'unknown', status: 'error', packages_updated: 0, error: 'Bulk patch request failed' }]);
    } finally {
      setPatching(false);
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
        <div className="flex items-center gap-2">
          <a
            href="/api/history/export/xlsx"
            download
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-700 hover:border-gray-600 hover:bg-gray-800 transition-colors text-sm text-gray-400 hover:text-white"
            title="Export all patch history as Excel (one sheet per host)"
          >
            <Download className="h-4 w-4" />
            Export
          </a>
          <button
            onClick={() => setShowPatchConfirm(true)}
            disabled={patching || scanning || !summary?.hosts_with_updates}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 transition-colors font-medium text-sm"
          >
            {patching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {patching ? 'Patching...' : 'Patch All'}
          </button>
          <button
            onClick={handleScanAll}
            disabled={scanning || patching}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition-colors font-medium text-sm"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {scanning ? 'Scanning...' : 'Scan All Hosts'}
          </button>
        </div>
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
              All Hosts <span className="ml-1 text-[10px] opacity-60">{hosts.length}</span>
            </button>
            {osTypes.map(t => (
              <button
                key={t}
                onClick={() => setOsFilter(osFilter === t ? 'all' : t)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  osFilter === t ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                {osLabel(t)} <span className="ml-0.5 text-[10px] opacity-60">{hosts.filter(h => h.os_type === t).length}</span>
              </button>
            ))}
            {tags.length > 0 && (
              <span className="mx-1 text-gray-700">|</span>
            )}
            {tags.map(tag => (
              <button
                key={tag.id}
                onClick={() => setTagFilter(tagFilter === tag.id ? 'all' : tag.id)}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                  tagFilter === tag.id ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} />
                {tag.name} <span className="text-[10px] opacity-60">{hosts.filter(h => h.tags?.some(t => t.id === tag.id)).length}</span>
              </button>
            ))}
            {(statusFilter !== 'all' || osFilter !== 'all' || tagFilter !== 'all') && (
              <button
                onClick={() => { setStatusFilter('all'); setOsFilter('all'); setTagFilter('all'); }}
                className="ml-auto text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Active filter indicator */}
          {(statusFilter !== 'all' || osFilter !== 'all' || tagFilter !== 'all') && (
            <div className="px-4 py-2 bg-gray-800/30 flex items-center gap-2 text-[11px] text-gray-400">
              <span>Showing</span>
              {statusFilter !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-700 text-gray-200">
                  {statusFilter === 'online' ? 'Online' : statusFilter === 'updates' ? 'Need updates' : 'Need reboot'}
                  <button onClick={() => setStatusFilter('all')} className="ml-0.5 hover:text-white">×</button>
                </span>
              )}
              {osFilter !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-700 text-gray-200">
                  {osLabel(osFilter)}
                  <button onClick={() => setOsFilter('all')} className="ml-0.5 hover:text-white">×</button>
                </span>
              )}
              {tagFilter !== 'all' && (() => {
                const tag = tags.find(t => t.id === tagFilter);
                return tag ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: tag.color }}>
                    {tag.name}
                    <button onClick={() => setTagFilter('all')} className="ml-0.5 hover:text-white/80">×</button>
                  </span>
                ) : null;
              })()}
              <span className="text-gray-500">- {filteredHosts.length} host{filteredHosts.length !== 1 ? 's' : ''}</span>
            </div>
          )}

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
                    {host.tags && host.tags.length > 0 && (
                      <div className="flex items-center gap-0.5">
                        {host.tags.map(t => (
                          <span key={t.id} className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} title={t.name} />
                        ))}
                      </div>
                    )}
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

      {/* Bulk patch results banner */}
      {patchResults && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Bulk Patch Results
            </span>
            <button
              onClick={() => setPatchResults(null)}
              className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
            >
              Dismiss
            </button>
          </div>
          <div className="divide-y divide-gray-800/50">
            {patchResults.map((r) => (
              <div key={r.host_id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                {r.status === 'success' ? (
                  <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                ) : r.status === 'failed' || r.status === 'error' ? (
                  <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                ) : (
                  <AlertOctagon className="h-4 w-4 text-amber-400 shrink-0" />
                )}
                <span className="font-medium w-36 truncate">{r.hostname}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  r.status === 'success' ? 'bg-emerald-500/10 text-emerald-400'
                    : r.status === 'failed' || r.status === 'error' ? 'bg-red-500/10 text-red-400'
                    : 'bg-amber-500/10 text-amber-400'
                }`}>
                  {r.status}
                </span>
                <span className="text-xs text-gray-500">
                  {r.packages_updated} pkg{r.packages_updated !== 1 ? 's' : ''} updated
                </span>
                {r.error && (
                  <span className="text-xs text-red-400/70 ml-auto truncate max-w-xs">{r.error}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Patch All confirmation dialog */}
      <ConfirmDialog
        open={showPatchConfirm}
        title="Patch All Hosts"
        message={
          <>
            This will apply <strong>standard upgrades</strong> to all online patch-eligible hosts.
            Kernel upgrades are <strong>excluded</strong> - those remain per-host opt-in only.
            <br /><br />
            <span className="text-gray-500 text-xs">
              {summary ? `${summary.hosts_online} host${summary.hosts_online !== 1 ? 's' : ''} online, ${summary.hosts_with_updates} with pending updates` : 'Loading...'}
            </span>
          </>
        }
        confirmLabel="Patch All"
        variant="warning"
        loading={patching}
        onConfirm={handlePatchAll}
        onCancel={() => setShowPatchConfirm(false)}
      />
    </div>
  );
}
