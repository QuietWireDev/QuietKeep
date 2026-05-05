// QuietKeep: HostCard.tsx
// Compact host card used in grid/list views. Shows hostname, IP, OS badge,
// status indicator, and pending update count.
// Author: QuietWire (Dennis Ayotte)

import { Circle, RotateCw, Server, Terminal } from 'lucide-react';
import type { Host } from '../types';
import { formatUTC } from '../utils/formatDate';

interface HostCardProps {
  host: Host;
  onClick: (host: Host) => void;
}

function osLabel(osType: string): string {
  switch (osType) {
    case 'apt': return 'Debian/Ubuntu';
    case 'pacman': return 'Arch/CachyOS';
    case 'proxmox': return 'Proxmox';
    default: return osType;
  }
}

function osBadgeColor(osType: string): string {
  switch (osType) {
    case 'apt': return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
    case 'pacman': return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
    case 'proxmox': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    default: return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  }
}

export default function HostCard({ host, onClick }: HostCardProps) {
  const statusColor = host.is_online ? 'text-emerald-400' : 'text-gray-600';
  const updatesBadge = host.pending_updates > 0;

  return (
    <button
      onClick={() => onClick(host)}
      className="w-full text-left bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 hover:bg-gray-900/80 transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-gray-500 group-hover:text-gray-400" />
          <span className="font-semibold text-sm">{host.hostname}</span>
          {!host.is_patch_target && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 border border-gray-700">
              MONITOR ONLY
            </span>
          )}
        </div>
        <Circle className={`h-3 w-3 fill-current ${statusColor}`} />
      </div>

      <div className="space-y-1.5 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <Terminal className="h-3 w-3" />
          <span>{host.ip_address}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className={`px-2 py-0.5 rounded-full text-[10px] border ${osBadgeColor(host.os_type)}`}>
            {osLabel(host.os_type)}
          </span>
          <div className="flex items-center gap-1.5">
            {host.reboot_required && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 font-medium">
                <RotateCw className="h-2.5 w-2.5" />
                Reboot
              </span>
            )}
            {updatesBadge ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                {host.pending_updates} update{host.pending_updates !== 1 ? 's' : ''}
              </span>
            ) : host.is_online ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Up to date
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {host.last_scan && (
        <p className="text-[10px] text-gray-600 mt-2">
          Scanned {formatUTC(host.last_scan)}
        </p>
      )}
    </button>
  );
}
