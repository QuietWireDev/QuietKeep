// QuietKeep: DockerStackDetail.tsx
// Single-stack detail view. Shows container table with image info, digest,
// update status, and release-notes links. Includes update action (pull + recreate)
// and post-update re-scan. Release URL logic resolves GHCR, Docker Hub, and
// Codeberg registries, with special-case mappings for monorepos (e.g. Immich).
// Author: QuietWire (Dennis Ayotte)

import { useState } from 'react';
import { ArrowLeft, Play, RefreshCw, Loader2, Clock, Container, ChevronDown, ChevronRight, Terminal, ExternalLink } from 'lucide-react';
import type { DockerStack } from '../types';
import { formatUTC } from '../utils/formatDate';
import { useDockerStackDetail, useDockerHistory, triggerDockerScanHost, triggerDockerUpdate } from '../hooks/useApi';
import ConfirmDialog from './ConfirmDialog';

// Known image-to-repo mappings for monorepos where the container image name
// doesn't match the GitHub repo name (e.g. immich publishes multiple images
// from a single repo).
const GHCR_REPO_MAP: Record<string, string> = {
  'immich-app/immich-server': 'immich-app/immich',
  'immich-app/immich-machine-learning': 'immich-app/immich',
  'immich-app/postgres': 'immich-app/immich',
  'blakeblackshear/frigate': 'blakeblackshear/frigate',
  'home-assistant/home-assistant': 'home-assistant/core',
};

const DOCKERHUB_REPO_MAP: Record<string, string> = {
  'joplin/server': 'https://github.com/laurent22/joplin/releases',
  'eclipse-mosquitto': 'https://github.com/eclipse-mosquitto/mosquitto/releases',
  'valkey/valkey': 'https://github.com/valkey-io/valkey/releases',
};

function getReleaseUrl(image: string): string | null {
  // Strip tag and digest
  const base = image.split(':')[0].split('@')[0];

  if (base.startsWith('ghcr.io/')) {
    const path = base.replace('ghcr.io/', '');
    const mapped = GHCR_REPO_MAP[path];
    if (mapped) return `https://github.com/${mapped}/releases`;
    // Fallback: if 3+ segments (org/sub/image), try org/sub as the repo
    const parts = path.split('/');
    if (parts.length >= 3) {
      return `https://github.com/${parts[0]}/${parts[1]}/releases`;
    }
    return `https://github.com/${path}/releases`;
  }
  if (base.startsWith('codeberg.org/')) {
    const repo = base.replace('codeberg.org/', '');
    return `https://codeberg.org/${repo}/releases`;
  }
  // Docker Hub: check known mappings first
  const cleaned = base.replace('docker.io/', '');
  if (DOCKERHUB_REPO_MAP[cleaned]) return DOCKERHUB_REPO_MAP[cleaned];
  if (cleaned.startsWith('library/')) {
    const name = cleaned.replace('library/', '');
    if (DOCKERHUB_REPO_MAP[name]) return DOCKERHUB_REPO_MAP[name];
    return `https://hub.docker.com/_/${name}`;
  }
  if (cleaned.includes('/')) {
    return `https://hub.docker.com/r/${cleaned}`;
  }
  return `https://hub.docker.com/_/${cleaned}`;
}

function parseImageParts(image: string) {
  // Split "ghcr.io/immich-app/immich-server:v2" into parts
  const atSplit = image.split('@');
  const isPinned = atSplit.length > 1;
  const tagPart = atSplit[0];
  const colonIdx = tagPart.lastIndexOf(':');
  const ref = colonIdx > 0 ? tagPart.substring(0, colonIdx) : tagPart;
  const tag = colonIdx > 0 ? tagPart.substring(colonIdx + 1) : 'latest';

  const segments = ref.split('/');
  const name = segments[segments.length - 1];
  const registry = segments.length > 2 ? segments[0] : segments.length > 1 ? segments[0] : '';
  const org = segments.length > 2 ? segments.slice(1, -1).join('/') : '';

  return { name, tag, registry, org, isPinned };
}

interface DockerStackDetailProps {
  stack: DockerStack;
  onBack: () => void;
}

export default function DockerStackDetail({ stack, onBack }: DockerStackDetailProps) {
  const { stack: detail, loading, refresh } = useDockerStackDetail(stack.id);
  const { history, loading: historyLoading, refresh: refreshHistory } = useDockerHistory(stack.id);
  const [scanning, setScanning] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState('');
  const [expandedLog, setExpandedLog] = useState<number | null>(null);
  // Centered confirmation modal state. Replaces native window.confirm() which
  // renders at the top of the viewport. See BUG-003.
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false);

  const handleScan = async () => {
    setScanning(true);
    setMessage('');
    try {
      await triggerDockerScanHost(stack.host_id);
      await refresh();
      await refreshHistory();
    } finally {
      setScanning(false);
    }
  };

  const runUpdate = async () => {
    setShowUpdateConfirm(false);
    setUpdating(true);
    setMessage(`Updating ${stack.stack_name}... This may take several minutes.`);
    try {
      await triggerDockerUpdate(stack.id);
      setMessage('Update complete. Scanning...');
      await triggerDockerScanHost(stack.host_id);
      await refresh();
      await refreshHistory();
      setMessage('');
    } catch {
      setMessage('Update failed. Check the log below.');
      await refreshHistory();
    } finally {
      setUpdating(false);
    }
  };

  const d = detail || stack;

  const statusColor = d.has_updates ? 'bg-amber-500' : d.status === 'running' ? 'bg-emerald-500' : 'bg-gray-600';
  const statusText = d.has_updates ? 'Updates Available' : d.status === 'running' ? 'Running' : d.status;
  const statusTextColor = d.has_updates ? 'text-amber-400' : d.status === 'running' ? 'text-emerald-400' : 'text-gray-500';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to Docker Stacks
        </button>
        <div className="flex gap-2">
          <button
            onClick={handleScan}
            disabled={scanning || updating}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Scan
          </button>
          {d.has_updates && (
            <button
              onClick={() => setShowUpdateConfirm(true)}
              disabled={updating || scanning}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition-colors text-sm font-medium"
            >
              {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Update
            </button>
          )}
        </div>
      </div>

      {/* Progress Banner */}
      {message && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex items-center gap-3">
          {(updating || scanning) && <Loader2 className="h-5 w-5 animate-spin text-blue-400 shrink-0" />}
          <p className="text-sm text-blue-300">{message}</p>
        </div>
      )}

      {/* Stack info - compact row */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex items-center gap-4 px-5 py-4">
          <div className={`w-1.5 h-10 rounded-full ${statusColor}`} />
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold">{d.stack_name}</h2>
              <span className={`text-xs font-medium ${statusTextColor}`}>{statusText}</span>
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
              <span>{d.hostname}</span>
              <span>·</span>
              <span className="font-mono">{d.host_ip}</span>
              {d.compose_path && (
                <>
                  <span>·</span>
                  <span className="font-mono truncate max-w-xs">{d.compose_path}</span>
                </>
              )}
              {d.last_scan && (
                <>
                  <span>·</span>
                  <span>Scanned {formatUTC(d.last_scan)}</span>
                </>
              )}
            </div>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-purple-300">{d.container_count}</p>
            <p className="text-[10px] text-gray-500">containers</p>
          </div>
        </div>
      </div>

      {/* Containers */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800">
          <Container className="h-4 w-4 text-purple-400" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Containers</span>
          <span className="text-xs text-gray-600 ml-auto">{detail?.containers?.length ?? 0} images</span>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
            </div>
          ) : !detail?.containers || detail.containers.length === 0 ? (
            <p className="text-gray-500 text-sm py-4 text-center">No container info. Run a scan to populate.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-800">
                    <th className="pb-2 font-medium text-[11px] uppercase tracking-wider">Container</th>
                    <th className="pb-2 font-medium text-[11px] uppercase tracking-wider">Image</th>
                    <th className="pb-2 font-medium text-[11px] uppercase tracking-wider">Digest</th>
                    <th className="pb-2 font-medium text-[11px] uppercase tracking-wider">Status</th>
                    <th className="pb-2 font-medium text-[11px] uppercase tracking-wider text-right">Update</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.containers.map((c) => {
                    const p = parseImageParts(c.image);
                    const releaseUrl = getReleaseUrl(c.image);
                    return (
                      <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                        <td className="py-2 font-mono text-xs">{c.container_name}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <div>
                              <div className="font-mono text-xs font-medium text-gray-200">
                                {p.name}<span className="text-blue-400">:{p.tag}</span>
                                {p.isPinned && <span className="text-gray-600 ml-1">(pinned)</span>}
                              </div>
                              <div className="font-mono text-[10px] text-gray-600">
                                {p.registry}{p.org ? `/${p.org}` : ''}
                              </div>
                            </div>
                            {releaseUrl && (
                              <a
                                href={releaseUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-gray-600 hover:text-blue-400 transition-colors shrink-0"
                                title="Release notes"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="py-2">
                          {c.current_digest ? (
                            <span className="font-mono text-[10px] text-gray-500" title={c.current_digest}>{c.current_digest}</span>
                          ) : (
                            <span className="text-gray-700 text-xs">-</span>
                          )}
                        </td>
                        <td className="py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            c.status === 'running'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-gray-500/10 text-gray-400'
                          }`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="py-2 text-right">
                          {p.isPinned ? (
                            <span className="text-xs text-gray-600">pinned</span>
                          ) : c.has_update ? (
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-400">
                              new image
                            </span>
                          ) : (
                            <span className="text-xs text-emerald-600">current</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Update History */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800">
          <Clock className="h-4 w-4 text-purple-400" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Update History</span>
          <span className="text-xs text-gray-600 ml-auto">{history.length} entries</span>
        </div>
        <div className="p-3">
          {historyLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-gray-500 text-sm py-4 text-center">No update history</p>
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
                            : h.status === 'failed'
                            ? 'bg-red-500/10 text-red-400'
                            : h.status === 'running'
                            ? 'bg-blue-500/10 text-blue-400'
                            : 'bg-gray-500/10 text-gray-400'
                        }`}
                      >
                        {h.status}
                      </span>
                      <span className="text-gray-400 text-xs">{h.images_updated} images</span>
                      {h.log_output && <Terminal className="h-3 w-3 text-gray-600" />}
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

      {/* Update confirmation. Centered overlay replaces native window.confirm(). */}
      <ConfirmDialog
        open={showUpdateConfirm}
        title="Update Docker Stack"
        message={
          <>
            Pull latest images and recreate{' '}
            <span className="text-white font-medium">{stack.stack_name}</span>{' '}
            on <span className="text-white font-medium">{stack.hostname}</span>?
          </>
        }
        confirmLabel="Update Stack"
        variant="warning"
        loading={updating}
        onConfirm={runUpdate}
        onCancel={() => setShowUpdateConfirm(false)}
      />
    </div>
  );
}
