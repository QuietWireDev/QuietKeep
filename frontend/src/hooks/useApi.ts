// QuietKeep: hooks/useApi.ts
// Centralized API layer. Provides React hooks (useDashboard, useHosts, etc.) for
// data fetching with loading/refresh state, and standalone async functions for
// mutations (create, update, delete, scan, patch, reboot).
// All requests go through fetchJson which prefixes /api and throws on non-2xx.
// Author: QuietWire (Dennis Ayotte)

import { useState, useEffect, useCallback } from 'react';
import type { Host, HostCreate, HostUpdate, HostDetail, DashboardSummary, PatchHistory, DockerStack, DockerStackDetail, DockerDashboardSummary, DockerUpdateHistory, SSHTestResult, CSVImportResult, AppSettings, AppSettingsUpdate, KEVCatalogResponse, KEVSummary, ThreatActor, SudoersFixResult, SudoersProbeResult } from '../types';

const API_BASE = '/api';
const DEFAULT_CACHE_TTL = 30_000; // 30 seconds

// Simple in-memory cache to avoid redundant fetches on tab switches.
// Each entry stores the response data and the timestamp it was fetched.
const _cache = new Map<string, { data: unknown; ts: number }>();

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchCached<T>(url: string, ttl: number = DEFAULT_CACHE_TTL): Promise<T> {
  const entry = _cache.get(url);
  if (entry && Date.now() - entry.ts < ttl) {
    return entry.data as T;
  }
  const data = await fetchJson<T>(url);
  _cache.set(url, { data, ts: Date.now() });
  return data;
}

function invalidateCache(url?: string) {
  if (url) _cache.delete(url);
  else _cache.clear();
}

export function useDashboard() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchCached<DashboardSummary>('/dashboard');
      setData(d);
    } catch (e) {
      console.error('Failed to fetch dashboard:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    invalidateCache('/dashboard');
    setLoading(true);
    try {
      const d = await fetchCached<DashboardSummary>('/dashboard', 0);
      setData(d);
    } catch (e) {
      console.error('Failed to fetch dashboard:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { data, loading, refresh };
}

export function useHosts() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const h = await fetchCached<Host[]>('/hosts');
      setHosts(h);
    } catch (e) {
      console.error('Failed to fetch hosts:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    invalidateCache('/hosts');
    setLoading(true);
    try {
      const h = await fetchCached<Host[]>('/hosts', 0);
      setHosts(h);
    } catch (e) {
      console.error('Failed to fetch hosts:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { hosts, loading, refresh };
}

export function useHostDetail(hostId: number | null) {
  const [host, setHost] = useState<HostDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (hostId === null) return;
    setLoading(true);
    try {
      const h = await fetchJson<HostDetail>(`/hosts/${hostId}`);
      setHost(h);
    } catch (e) {
      console.error('Failed to fetch host detail:', e);
    } finally {
      setLoading(false);
    }
  }, [hostId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { host, loading, refresh };
}

export function useHistory(hostId?: number) {
  const [history, setHistory] = useState<PatchHistory[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const url = hostId ? `/history/${hostId}` : '/history';
      const h = await fetchJson<PatchHistory[]>(url);
      setHistory(h);
    } catch (e) {
      console.error('Failed to fetch history:', e);
    } finally {
      setLoading(false);
    }
  }, [hostId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { history, loading, refresh };
}

// Global scan promise so other components can detect an in-flight scan
let _activeScanPromise: Promise<void> | null = null;

export function isScanRunning(): boolean {
  return _activeScanPromise !== null;
}

export function getActiveScanPromise(): Promise<void> | null {
  return _activeScanPromise;
}

export async function triggerScanAll(): Promise<void> {
  const p = fetchJson<void>('/scan', { method: 'POST' }).finally(() => {
    if (_activeScanPromise === p) _activeScanPromise = null;
  });
  _activeScanPromise = p;
  await p;
}

export async function triggerScanHost(hostId: number): Promise<void> {
  await fetchJson(`/scan/${hostId}`, { method: 'POST' });
}

export async function triggerPatchHosts(hostIds: number[]): Promise<void> {
  await fetchJson('/patch', {
    method: 'POST',
    body: JSON.stringify({ host_ids: hostIds }),
  });
}

export async function triggerPatchHost(hostId: number): Promise<void> {
  await fetchJson(`/patch/${hostId}`, { method: 'POST' });
}

// Install the packages apt kept back on the last patch run. Runs
// apt-get upgrade --with-new-pkgs on the backend via a dedicated
// endpoint. Typically brings in kernel metapackages and usually leaves
// the host wanting a reboot; the next scan picks that up automatically.
export async function triggerInstallHeldBack(hostId: number): Promise<void> {
  await fetchJson(`/patch/${hostId}/install-held-back`, { method: 'POST' });
}

export async function triggerReboot(hostId: number): Promise<void> {
  await fetchJson(`/reboot/${hostId}`, { method: 'POST' });
}

// ─── Host Management ──────────────────────────────────────────────────────

export async function createHost(data: HostCreate): Promise<Host> {
  const result = await fetchJson<Host>('/hosts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  invalidateCache('/hosts');
  return result;
}

export async function updateHost(hostId: number, data: HostUpdate): Promise<Host> {
  const result = await fetchJson<Host>(`/hosts/${hostId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  invalidateCache('/hosts');
  return result;
}

export async function deleteHost(hostId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/hosts/${hostId}`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  invalidateCache('/hosts');
}

export async function deleteAllHosts(): Promise<void> {
  const res = await fetch(`${API_BASE}/hosts`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  invalidateCache();
}

export async function testHostSSH(hostId: number): Promise<SSHTestResult> {
  return fetchJson<SSHTestResult>(`/hosts/${hostId}/test`, { method: 'POST' });
}

export async function probeSudoers(hostId: number): Promise<SudoersProbeResult> {
  return fetchJson<SudoersProbeResult>(`/hosts/${hostId}/probe-sudoers`, { method: 'POST' });
}

export async function fixSudoers(hostId: number, password: string): Promise<SudoersFixResult> {
  return fetchJson<SudoersFixResult>(`/hosts/${hostId}/fix-sudoers`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function importHostsCSV(file: File): Promise<CSVImportResult> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/hosts/import`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

export function exportHostsCSV(): void {
  window.open(`${API_BASE}/hosts/export`, '_blank');
}

export function downloadHostsTemplate(): void {
  window.open(`${API_BASE}/hosts/template`, '_blank');
}

// ─── Settings Hooks ───────────────────────────────────────────────────────

export function useSettings() {
  const [data, setData] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchCached<AppSettings>('/settings');
      setData(s);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    invalidateCache('/settings');
    setLoading(true);
    try {
      const s = await fetchCached<AppSettings>('/settings', 0);
      setData(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { settings: data, loading, refresh };
}

export async function updateSettings(data: AppSettingsUpdate): Promise<AppSettings> {
  const result = await fetchJson<AppSettings>('/settings', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  invalidateCache('/settings');
  return result;
}

// ─── Docker Hooks ──────────────────────────────────────────────────────────

export function useDockerDashboard() {
  const [data, setData] = useState<DockerDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchCached<DockerDashboardSummary>('/docker/dashboard');
      setData(d);
    } catch (e) {
      console.error('Failed to fetch docker dashboard:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    invalidateCache('/docker/dashboard');
    setLoading(true);
    try {
      const d = await fetchCached<DockerDashboardSummary>('/docker/dashboard', 0);
      setData(d);
    } catch (e) {
      console.error('Failed to fetch docker dashboard:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { data, loading, refresh };
}

export function useDockerStacks() {
  const [stacks, setStacks] = useState<DockerStack[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchCached<DockerStack[]>('/docker/stacks');
      setStacks(s);
    } catch (e) {
      console.error('Failed to fetch docker stacks:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    invalidateCache('/docker/stacks');
    setLoading(true);
    try {
      const s = await fetchCached<DockerStack[]>('/docker/stacks', 0);
      setStacks(s);
    } catch (e) {
      console.error('Failed to fetch docker stacks:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { stacks, loading, refresh };
}

export function useDockerStackDetail(stackId: number | null) {
  const [stack, setStack] = useState<DockerStackDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (stackId === null) return;
    setLoading(true);
    try {
      const s = await fetchJson<DockerStackDetail>(`/docker/stacks/${stackId}`);
      setStack(s);
    } catch (e) {
      console.error('Failed to fetch docker stack detail:', e);
    } finally {
      setLoading(false);
    }
  }, [stackId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { stack, loading, refresh };
}

export function useDockerHistory(stackId?: number) {
  const [history, setHistory] = useState<DockerUpdateHistory[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!stackId) { setLoading(false); return; }
    setLoading(true);
    try {
      const h = await fetchJson<DockerUpdateHistory[]>(`/docker/history/${stackId}`);
      setHistory(h);
    } catch (e) {
      console.error('Failed to fetch docker history:', e);
    } finally {
      setLoading(false);
    }
  }, [stackId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { history, loading, refresh };
}

export async function triggerDockerScanAll(): Promise<void> {
  await fetchJson('/docker/scan', { method: 'POST' });
}

export async function triggerDockerScanHost(hostId: number): Promise<void> {
  await fetchJson(`/docker/scan/${hostId}`, { method: 'POST' });
}

export async function triggerDockerUpdate(stackId: number): Promise<void> {
  await fetchJson(`/docker/update/${stackId}`, { method: 'POST' });
}

// ─── Threat Intel (CISA KEV) ──────────────────────────────────────────────

export function useKEVSummary() {
  const [data, setData] = useState<KEVSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchCached<KEVSummary>('/threat-intel/kev/summary', 60_000);
      setData(d);
    } catch (e) {
      console.error('Failed to fetch KEV summary:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    invalidateCache('/threat-intel/kev/summary');
    setLoading(true);
    try {
      const d = await fetchCached<KEVSummary>('/threat-intel/kev/summary', 0);
      setData(d);
    } catch (e) {
      console.error('Failed to fetch KEV summary:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { data, loading, refresh };
}

export function useKEVCatalog(params: { days?: number; vendor?: string; search?: string; ransomware_only?: boolean; actor?: string; limit?: number; offset?: number } = {}) {
  const [data, setData] = useState<KEVCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Serialize params to a stable string so useCallback re-fires when filters change.
  const key = JSON.stringify(params);

  const refresh = useCallback(async () => {
    const p = JSON.parse(key) as typeof params;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (p.days) qs.set('days', String(p.days));
      if (p.vendor) qs.set('vendor', p.vendor);
      if (p.search) qs.set('search', p.search);
      if (p.ransomware_only) qs.set('ransomware_only', 'true');
      if (p.actor) qs.set('actor', p.actor);
      if (p.limit) qs.set('limit', String(p.limit));
      if (p.offset) qs.set('offset', String(p.offset));
      const q = qs.toString();
      const d = await fetchJson<KEVCatalogResponse>(`/threat-intel/kev${q ? '?' + q : ''}`);
      setData(d);
    } catch (e) {
      console.error('Failed to fetch KEV catalog:', e);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => { refresh(); }, [refresh]);
  return { data, loading, refresh };
}

export function useThreatActors() {
  const [actors, setActors] = useState<ThreatActor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJson<{ actors: ThreatActor[] }>('/threat-intel/actors')
      .then(d => setActors(d.actors))
      .catch(e => console.error('Failed to fetch threat actors:', e))
      .finally(() => setLoading(false));
  }, []);

  return { actors, loading };
}
