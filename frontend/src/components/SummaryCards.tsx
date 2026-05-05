// QuietKeep: SummaryCards.tsx
// Clickable metric cards for the dashboard. Each card doubles as a filter toggle
// (e.g. clicking "Need Updates" filters the host list to only those hosts).
// Author: QuietWire (Dennis Ayotte)

import { Monitor, Wifi, AlertTriangle, Package, RotateCw } from 'lucide-react';
import type { DashboardSummary } from '../types';

export type HostFilter = 'all' | 'online' | 'updates' | 'reboot';

interface SummaryCardsProps {
  data: DashboardSummary | null;
  loading: boolean;
  activeFilter: HostFilter;
  onFilterChange: (filter: HostFilter) => void;
}

function Card({
  icon: Icon,
  label,
  value,
  color,
  active,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`bg-gray-900 border rounded-xl p-5 flex items-center gap-4 transition-all text-left ${
        active
          ? 'border-blue-500 ring-1 ring-blue-500/30'
          : 'border-gray-800 hover:border-gray-700'
      } ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className="text-sm text-gray-400">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </div>
    </button>
  );
}

export default function SummaryCards({ data, loading, activeFilter, onFilterChange }: SummaryCardsProps) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5 h-24 animate-pulse" />
        ))}
      </div>
    );
  }

  const toggle = (filter: HostFilter) => {
    onFilterChange(activeFilter === filter ? 'all' : filter);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      <Card
        icon={Monitor}
        label="Total Hosts"
        value={data.total_hosts}
        color="bg-blue-500/10 text-blue-400"
        active={activeFilter === 'all'}
        onClick={() => onFilterChange('all')}
      />
      <Card
        icon={Wifi}
        label="Online"
        value={data.hosts_online}
        color="bg-emerald-500/10 text-emerald-400"
        active={activeFilter === 'online'}
        onClick={() => toggle('online')}
      />
      <Card
        icon={AlertTriangle}
        label="Need Updates"
        value={data.hosts_with_updates}
        color={data.hosts_with_updates > 0 ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}
        active={activeFilter === 'updates'}
        onClick={() => toggle('updates')}
      />
      <Card icon={Package} label="Pending Packages" value={data.total_pending_packages} color="bg-purple-500/10 text-purple-400" />
      <Card
        icon={RotateCw}
        label="Need Reboot"
        value={data.hosts_needing_reboot}
        color={data.hosts_needing_reboot > 0 ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}
        active={activeFilter === 'reboot'}
        onClick={() => toggle('reboot')}
      />
    </div>
  );
}
