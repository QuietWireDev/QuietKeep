// QuietKeep: ThreatIntel.tsx
// CISA KEV catalog browser. Fetches the proxied/cached KEV feed from the backend
// and filters by time range, vendor, threat actor, and ransomware linkage,
// with client-side pagination. Urgency colors are based on
// the CISA remediation due date relative to today.
// Author: QuietWire (Dennis Ayotte)

import { useState, useMemo } from 'react';
import { Shield, AlertTriangle, Clock, Search, Loader2, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { useKEVSummary, useKEVCatalog, useThreatActors } from '../hooks/useApi';
import type { KEVVulnerability } from '../types';

type TimeFilter = 'all' | '7' | '30' | '90';

function daysAgo(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00Z');
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / 86400000);
}

// Urgency is based on CISA's remediation due date:
//   past due → red, within 7 days → amber, otherwise → neutral
function urgencyColor(dueDate: string): string {
  const days = daysAgo(dueDate);
  if (days > 0) return 'text-red-400';
  if (days > -7) return 'text-amber-400';
  return 'text-gray-400';
}

function urgencyBg(dueDate: string): string {
  const days = daysAgo(dueDate);
  if (days > 0) return 'bg-red-500';
  if (days > -7) return 'bg-amber-500';
  return 'bg-emerald-500';
}

const PAGE_SIZE = 50;

export default function ThreatIntel() {
  const { data: summary, loading: summaryLoading } = useKEVSummary();
  const { actors } = useThreatActors();
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [vendorFilter, setVendorFilter] = useState<string>('all');
  const [actorFilter, setActorFilter] = useState<string>('all');
  const [ransomwareOnly, setRansomwareOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [expandedCve, setExpandedCve] = useState<string | null>(null);

  const catalogParams = useMemo(() => ({
    days: timeFilter !== 'all' ? parseInt(timeFilter) : undefined,
    vendor: vendorFilter !== 'all' ? vendorFilter : undefined,
    actor: actorFilter !== 'all' ? actorFilter : undefined,
    ransomware_only: ransomwareOnly || undefined,
    search: debouncedSearch || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [timeFilter, vendorFilter, actorFilter, ransomwareOnly, debouncedSearch, page]);

  const { data: catalog, loading: catalogLoading } = useKEVCatalog(catalogParams);

  const loading = summaryLoading || catalogLoading;

  const topVendors = useMemo(() =>
    summary?.top_vendors?.slice(0, 6) ?? [],
    [summary]);

  const totalPages = catalog ? Math.ceil(catalog.total / PAGE_SIZE) : 0;

  const hasActiveFilters = timeFilter !== 'all' || vendorFilter !== 'all' || actorFilter !== 'all' || ransomwareOnly || searchQuery;

  function resetFilters() {
    setTimeFilter('all');
    setVendorFilter('all');
    setActorFilter('all');
    setRansomwareOnly(false);
    setSearchQuery('');
    setDebouncedSearch('');
    setPage(0);
  }

  function handleTimeFilter(t: TimeFilter) {
    setTimeFilter(t);
    setPage(0);
  }

  function handleVendorFilter(v: string) {
    setVendorFilter(v);
    setPage(0);
  }

  function handleActorFilter(a: string) {
    setActorFilter(a);
    setPage(0);
  }

  function handleSearch(q: string) {
    setSearchQuery(q);
    setDebouncedSearch(q);
    setPage(0);
  }

  function toggleRansomware() {
    setRansomwareOnly(!ransomwareOnly);
    setPage(0);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Threat Intel</h2>
          <p className="text-xs text-gray-500 mt-1">
            CISA Known Exploited Vulnerabilities (KEV) catalog
            {summary?.date_released && <span> · Updated {summary.date_released}</span>}
          </p>
        </div>
        <a
          href="https://www.cisa.gov/known-exploited-vulnerabilities-catalog"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 hover:border-gray-600 text-sm text-gray-400 hover:text-gray-200 transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          CISA Source
        </a>
      </div>

      {/* Metric tiles */}
      {summaryLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl h-24 animate-pulse" />
          ))}
        </div>
      ) : summary && !summary.error && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-gradient-to-b from-blue-500/15 to-blue-500/5 border border-blue-500/20 rounded-xl p-4">
            <Shield className="h-4 w-4 text-blue-400 mb-2" />
            <p className="text-2xl font-bold text-blue-300">{summary.total.toLocaleString()}</p>
            <p className="text-[10px] text-blue-400/50">total KEVs tracked</p>
          </div>

          <button
            onClick={() => handleTimeFilter(timeFilter === '7' ? 'all' : '7')}
            className={`bg-gradient-to-b from-amber-500/15 to-amber-500/5 border rounded-xl p-4 text-left transition-all ${
              timeFilter === '7' ? 'border-amber-400/50 ring-1 ring-amber-400/20' : 'border-amber-500/20 hover:border-amber-400/30'
            }`}
          >
            <Clock className="h-4 w-4 text-amber-400 mb-2" />
            <p className="text-2xl font-bold text-amber-300">{summary.added_this_week}</p>
            <p className="text-[10px] text-amber-400/50">added this week</p>
          </button>

          <button
            onClick={() => handleTimeFilter(timeFilter === '30' ? 'all' : '30')}
            className={`bg-gradient-to-b from-purple-500/15 to-purple-500/5 border rounded-xl p-4 text-left transition-all ${
              timeFilter === '30' ? 'border-purple-400/50 ring-1 ring-purple-400/20' : 'border-purple-500/20 hover:border-purple-400/30'
            }`}
          >
            <AlertTriangle className="h-4 w-4 text-purple-400 mb-2" />
            <p className="text-2xl font-bold text-purple-300">{summary.added_this_month}</p>
            <p className="text-[10px] text-purple-400/50">added this month</p>
          </button>

          <button
            onClick={toggleRansomware}
            className={`bg-gradient-to-b border rounded-xl p-4 text-left transition-all ${
              ransomwareOnly
                ? 'from-red-500/15 to-red-500/5 border-red-400/50 ring-1 ring-red-400/20'
                : 'from-red-500/15 to-red-500/5 border-red-500/20 hover:border-red-400/30'
            }`}
          >
            <AlertTriangle className="h-4 w-4 text-red-400 mb-2" />
            <p className="text-2xl font-bold text-red-300">
              {summary.ransomware_linked.toLocaleString()}
            </p>
            <p className="text-[10px] text-red-400/50">ransomware-linked</p>
          </button>
        </div>
      )}

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
        <input
          type="text"
          placeholder="Search CVE ID, vendor, product, description, or threat actor (e.g. Akira, LockBit)..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors"
        />
      </div>

      {/* Vulnerability list */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {/* Filter tabs */}
        <div className="px-4 py-3 border-b border-gray-800 space-y-2">
          {/* Row 1: Time + Vendor filters */}
          <div className="flex items-center gap-1 flex-wrap">
            {([
              { id: 'all' as TimeFilter, label: 'All Time' },
              { id: '7' as TimeFilter, label: 'Last 7 days' },
              { id: '30' as TimeFilter, label: 'Last 30 days' },
              { id: '90' as TimeFilter, label: 'Last 90 days' },
            ] as const).map(t => (
              <button
                key={t.id}
                onClick={() => handleTimeFilter(t.id)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  timeFilter === t.id ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                {t.label}
              </button>
            ))}

            <span className="w-px h-4 bg-gray-700 mx-1" />

            <button
              onClick={() => handleVendorFilter('all')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                vendorFilter === 'all' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
              }`}
            >
              All Vendors
            </button>
            {topVendors.map(v => (
              <button
                key={v.vendor}
                onClick={() => handleVendorFilter(vendorFilter === v.vendor ? 'all' : v.vendor)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  vendorFilter === v.vendor ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                {v.vendor}
                <span className="text-gray-600 ml-1">{v.count}</span>
              </button>
            ))}

            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                className="ml-auto text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Row 2: Threat actor tabs */}
          {actors.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-gray-600 uppercase tracking-wider mr-1">Threat Actors</span>
              <button
                onClick={() => handleActorFilter('all')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  actorFilter === 'all' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                All
              </button>
              {actors.map(a => (
                <button
                  key={a.name}
                  onClick={() => handleActorFilter(actorFilter === a.name ? 'all' : a.name)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                    actorFilter === a.name
                      ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                  }`}
                >
                  {a.name}
                  <span className="text-gray-600 ml-1">{a.cve_count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Result count + pagination header */}
        {catalog && (
          <div className="px-4 py-2 border-b border-gray-800/50 flex items-center justify-between text-[10px] text-gray-500">
            <span>{catalog.total.toLocaleString()} vulnerabilities</span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-0.5 disabled:opacity-30 hover:text-gray-300 transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span>Page {page + 1} of {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-0.5 disabled:opacity-30 hover:text-gray-300 transition-colors"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* CVE rows */}
        <div className="divide-y divide-gray-800/50">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
            </div>
          ) : !catalog || catalog.vulnerabilities.length === 0 ? (
            <p className="text-gray-500 text-sm py-12 text-center">
              {catalog?.error ? `Error: ${catalog.error}` : 'No vulnerabilities match the current filters'}
            </p>
          ) : (
            catalog.vulnerabilities.map((vuln: KEVVulnerability) => (
              <div key={vuln.cveID}>
                <button
                  onClick={() => setExpandedCve(expandedCve === vuln.cveID ? null : vuln.cveID)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/40 transition-colors text-left group"
                >
                  <div className={`w-1 h-6 rounded-full shrink-0 ${urgencyBg(vuln.dueDate)}`} />

                  <span className="text-xs font-mono font-medium text-blue-400 w-32 shrink-0">
                    {vuln.cveID}
                  </span>

                  <span className="text-xs text-gray-400 w-28 truncate shrink-0">
                    {vuln.vendorProject}
                  </span>
                  <span className="text-xs text-gray-300 w-28 truncate shrink-0">
                    {vuln.product}
                  </span>

                  <span className="text-xs text-gray-400 flex-1 truncate">
                    {vuln.vulnerabilityName}
                  </span>

                  {/* Threat actor badges */}
                  {vuln.threat_actors && vuln.threat_actors.length > 0 && (
                    <span className="flex items-center gap-1 shrink-0">
                      {vuln.threat_actors.slice(0, 2).map(a => (
                        <span key={a} className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">
                          {a}
                        </span>
                      ))}
                      {vuln.threat_actors.length > 2 && (
                        <span className="text-[9px] text-orange-400/50">+{vuln.threat_actors.length - 2}</span>
                      )}
                    </span>
                  )}

                  {vuln.knownRansomwareCampaignUse === 'Known' && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 shrink-0">
                      RANSOMWARE
                    </span>
                  )}

                  <span className={`text-[11px] w-20 text-right shrink-0 ${urgencyColor(vuln.dueDate)}`}>
                    {vuln.dueDate}
                  </span>

                  <span className="text-[10px] text-gray-600 w-20 text-right shrink-0">
                    +{vuln.dateAdded}
                  </span>
                </button>

                {expandedCve === vuln.cveID && (
                  <div className="px-4 pb-4 pt-1 bg-gray-800/20">
                    <div className="ml-10 space-y-2">
                      <p className="text-sm text-gray-300 leading-relaxed">{vuln.shortDescription}</p>
                      <div className="flex items-start gap-6 text-xs">
                        <div>
                          <span className="text-gray-500">Required Action:</span>
                          <p className="text-gray-400 mt-0.5">{vuln.requiredAction}</p>
                        </div>
                      </div>
                      {vuln.threat_actors && vuln.threat_actors.length > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Known threat actors:</span>
                          {vuln.threat_actors.map(a => (
                            <button
                              key={a}
                              onClick={(e) => { e.stopPropagation(); handleActorFilter(a); }}
                              className="text-[10px] px-2 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20 transition-colors"
                            >
                              {a}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>Added: {vuln.dateAdded}</span>
                        <span>Due: <span className={urgencyColor(vuln.dueDate)}>{vuln.dueDate}</span></span>
                        {vuln.knownRansomwareCampaignUse === 'Known' && (
                          <span className="text-red-400">Known ransomware use</span>
                        )}
                        {vuln.notes && vuln.notes !== '' && (
                          <span className="text-gray-600 truncate max-w-md">{vuln.notes}</span>
                        )}
                      </div>
                      <a
                        href={`https://nvd.nist.gov/vuln/detail/${vuln.cveID}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                        View on NVD
                      </a>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
