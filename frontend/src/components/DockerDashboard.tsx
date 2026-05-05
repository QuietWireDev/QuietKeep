// QuietKeep: DockerDashboard.tsx
// Docker Stacks tab. Lists all discovered compose stacks with metric tiles,
// host-based filter tabs, and status filters. Clicking a stack opens
// DockerStackDetail. Stacks with available updates sort to the top.
// Author: QuietWire (Dennis Ayotte)

import { useState, useMemo } from 'react';
import { RefreshCw, Loader2, Container, Server, AlertTriangle, Box } from 'lucide-react';
import type { DockerStack } from '../types';
import { useDockerDashboard, useDockerStacks, triggerDockerScanAll } from '../hooks/useApi';
import DockerStackDetail from './DockerStackDetail';
import { formatUTC } from '../utils/formatDate';

type StatusFilter = 'all' | 'has_updates' | 'running';

export default function DockerDashboard() {
  const { data: summary, loading: summaryLoading, refresh: refreshSummary } = useDockerDashboard();
  const { stacks, loading: stacksLoading, refresh: refreshStacks } = useDockerStacks();
  const [selectedStack, setSelectedStack] = useState<DockerStack | null>(null);
  const [scanning, setScanning] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [hostFilter, setHostFilter] = useState<string>('all');

  const loading = summaryLoading || stacksLoading;

  // Unique Docker hosts from stacks
  const dockerHosts = useMemo(() =>
    [...new Set(stacks.map(s => s.hostname).filter(Boolean))].sort() as string[],
    [stacks]);

  const filteredStacks = useMemo(() => {
    let result = stacks;
    if (statusFilter === 'has_updates') result = result.filter(s => s.has_updates);
    else if (statusFilter === 'running') result = result.filter(s => s.status === 'running');
    if (hostFilter !== 'all') result = result.filter(s => s.hostname === hostFilter);
    // Sort: updates first, then by name
    return [...result].sort((a, b) => {
      if (a.has_updates !== b.has_updates) return a.has_updates ? -1 : 1;
      return a.stack_name.localeCompare(b.stack_name);
    });
  }, [stacks, statusFilter, hostFilter]);

  const handleScanAll = async () => {
    setScanning(true);
    try {
      await triggerDockerScanAll();
      await refreshSummary();
      await refreshStacks();
    } finally {
      setScanning(false);
    }
  };

  if (selectedStack) {
    return (
      <DockerStackDetail
        stack={selectedStack}
        onBack={() => {
          setSelectedStack(null);
          refreshSummary();
          refreshStacks();
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Docker Stacks</h2>
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
          {scanning ? 'Scanning...' : 'Scan All Stacks'}
        </button>
      </div>

      {/* Metric tiles */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl h-24 animate-pulse" />
          ))}
        </div>
      ) : summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-gradient-to-b from-blue-500/15 to-blue-500/5 border border-blue-500/20 rounded-xl p-4">
            <Server className="h-4 w-4 text-blue-400 mb-2" />
            <p className="text-2xl font-bold text-blue-300">{summary.docker_hosts}</p>
            <p className="text-[10px] text-blue-400/50">Docker hosts</p>
          </div>

          <button
            onClick={() => setStatusFilter(statusFilter === 'all' ? 'all' : 'all')}
            className={`bg-gradient-to-b from-purple-500/15 to-purple-500/5 border rounded-xl p-4 text-left transition-all ${
              statusFilter === 'all' ? 'border-purple-400/50 ring-1 ring-purple-400/20' : 'border-purple-500/20 hover:border-purple-400/30'
            }`}
          >
            <Container className="h-4 w-4 text-purple-400 mb-2" />
            <p className="text-2xl font-bold text-purple-300">{summary.total_stacks}</p>
            <p className="text-[10px] text-purple-400/50">total stacks</p>
          </button>

          <button
            onClick={() => setStatusFilter(statusFilter === 'running' ? 'all' : 'running')}
            className={`bg-gradient-to-b from-emerald-500/15 to-emerald-500/5 border rounded-xl p-4 text-left transition-all ${
              statusFilter === 'running' ? 'border-emerald-400/50 ring-1 ring-emerald-400/20' : 'border-emerald-500/20 hover:border-emerald-400/30'
            }`}
          >
            <Box className="h-4 w-4 text-emerald-400 mb-2" />
            <p className="text-2xl font-bold text-emerald-300">{stacks.filter(s => s.status === 'running').length}</p>
            <p className="text-[10px] text-emerald-400/50">running</p>
          </button>

          <button
            onClick={() => setStatusFilter(statusFilter === 'has_updates' ? 'all' : 'has_updates')}
            className={`bg-gradient-to-b border rounded-xl p-4 text-left transition-all ${
              statusFilter === 'has_updates'
                ? 'from-amber-500/15 to-amber-500/5 border-amber-400/50 ring-1 ring-amber-400/20'
                : summary.stacks_with_updates > 0
                  ? 'from-amber-500/15 to-amber-500/5 border-amber-500/20 hover:border-amber-400/30'
                  : 'from-emerald-500/15 to-emerald-500/5 border-emerald-500/20 hover:border-emerald-400/30'
            }`}
          >
            <AlertTriangle className={`h-4 w-4 mb-2 ${summary.stacks_with_updates > 0 ? 'text-amber-400' : 'text-emerald-400'}`} />
            <p className={`text-2xl font-bold ${summary.stacks_with_updates > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
              {summary.stacks_with_updates}
            </p>
            <p className="text-[10px] text-gray-400/50">need updates</p>
          </button>
        </div>
      )}

      {/* Stack list */}
      {!loading && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {/* Filter tabs - by host */}
          <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setHostFilter('all')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                hostFilter === 'all' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
              }`}
            >
              All Hosts
            </button>
            {dockerHosts.map(h => (
              <button
                key={h}
                onClick={() => setHostFilter(hostFilter === h ? 'all' : h)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  hostFilter === h ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                {h}
              </button>
            ))}
            {(statusFilter !== 'all' || hostFilter !== 'all') && (
              <button
                onClick={() => { setStatusFilter('all'); setHostFilter('all'); }}
                className="ml-auto text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Stack rows */}
          <div className="divide-y divide-gray-800/50">
            {filteredStacks.length === 0 ? (
              <p className="text-gray-500 text-sm py-8 text-center">
                {stacks.length === 0 ? 'No Docker stacks found. Click "Scan All Stacks" to discover them.' : 'No stacks match the current filters'}
              </p>
            ) : (
              filteredStacks.map(stack => (
                <button
                  key={stack.id}
                  onClick={() => setSelectedStack(stack)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/40 transition-colors text-left group"
                >
                  {/* Status indicator */}
                  <div className={`w-1 h-6 rounded-full ${
                    stack.has_updates ? 'bg-amber-500' : stack.status === 'running' ? 'bg-emerald-500' : 'bg-gray-600'
                  }`} />

                  {/* Stack name */}
                  <span className="text-sm font-medium w-40 truncate group-hover:text-white transition-colors">
                    {stack.stack_name}
                  </span>

                  {/* Host */}
                  <span className="text-xs text-gray-500 w-28 truncate">{stack.hostname}</span>

                  {/* IP */}
                  <span className="text-xs text-gray-500 w-28 font-mono">{stack.host_ip}</span>

                  {/* Container count */}
                  <span className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                    {stack.container_count} container{stack.container_count !== 1 ? 's' : ''}
                  </span>

                  {/* Status */}
                  <div className="flex items-center gap-2 ml-auto">
                    <span className={`text-[11px] ${
                      stack.status === 'running' ? 'text-emerald-400/70' : 'text-gray-600'
                    }`}>
                      {stack.status}
                    </span>
                    {stack.has_updates && (
                      <span className="text-[11px] text-amber-400 font-medium">update available</span>
                    )}
                  </div>

                  {/* Last scan */}
                  <span className="text-[10px] text-gray-600 w-36 text-right">
                    {stack.last_scan ? formatUTC(stack.last_scan) : 'Never'}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
