// QuietKeep: HostManagement.tsx
// CRUD interface for managed hosts. Supports add/edit/delete single hosts,
// bulk delete-all with confirmation modal, CSV import/export, template download,
// and per-host SSH connectivity testing.
// Author: QuietWire (Dennis Ayotte)

import { useState, useRef } from 'react';
import { Plus, Pencil, Trash2, Wifi, WifiOff, Upload, Download, FileDown, X, Check, Loader2, Server, ShieldCheck, ShieldAlert, ShieldQuestion, KeyRound, Cpu } from 'lucide-react';
import type { Host, HostCreate, HostUpdate, CSVImportResult } from '../types';
import { useHosts, createHost, updateHost, deleteHost, deleteAllHosts, testHostSSH, importHostsCSV, exportHostsCSV, downloadHostsTemplate, fixSudoers } from '../hooks/useApi';
import FixSudoersModal from './FixSudoersModal';
import ConfirmDialog from './ConfirmDialog';

const OS_OPTIONS = [
  { value: 'apt', label: 'Debian/Ubuntu' },
  { value: 'kali', label: 'Kali Linux' },
  { value: 'pacman', label: 'Arch/CachyOS' },
  { value: 'proxmox', label: 'Proxmox' },
];

const EMPTY_HOST: HostCreate = {
  hostname: '',
  ip_address: '',
  username: '',
  os_type: 'apt',
  is_patch_target: true,
  has_docker: false,
};

type SSHStatus = { [hostId: number]: 'testing' | 'success' | 'failed' | null };

export default function HostManagement() {
  const { hosts, loading, refresh } = useHosts();
  const [showForm, setShowForm] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [formData, setFormData] = useState<HostCreate>(EMPTY_HOST);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [sshStatus, setSSHStatus] = useState<SSHStatus>({});
  const [importResult, setImportResult] = useState<CSVImportResult | null>(null);
  // Host currently targeted by the Fix Sudoers modal. null when closed.
  const [sudoersTarget, setSudoersTarget] = useState<Host | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function openAddForm() {
    setEditingHost(null);
    setFormData(EMPTY_HOST);
    setError(null);
    setShowForm(true);
  }

  function openEditForm(host: Host) {
    setEditingHost(host);
    setFormData({
      hostname: host.hostname,
      ip_address: host.ip_address,
      username: host.username,
      os_type: host.os_type,
      is_patch_target: host.is_patch_target,
      has_docker: host.has_docker,
    });
    setError(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingHost(null);
    setFormData(EMPTY_HOST);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editingHost) {
        const changes: HostUpdate = {};
        const keys = Object.keys(formData) as (keyof HostCreate)[];
        for (const key of keys) {
          if (formData[key] !== editingHost[key]) {
            (changes as Record<string, unknown>)[key] = formData[key];
          }
        }
        await updateHost(editingHost.id, changes);
      } else {
        await createHost(formData);
      }
      closeForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save host');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(hostId: number) {
    try {
      await deleteHost(hostId);
      setDeleteConfirm(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete host');
    }
  }

  async function handleTestSSH(hostId: number) {
    setSSHStatus(prev => ({ ...prev, [hostId]: 'testing' }));
    try {
      const result = await testHostSSH(hostId);
      setSSHStatus(prev => ({ ...prev, [hostId]: result.success ? 'success' : 'failed' }));
      // Backend now persists is_online and sudoers_ok on every test; pull
      // fresh state so the column badges match the click result.
      await refresh();
    } catch {
      setSSHStatus(prev => ({ ...prev, [hostId]: 'failed' }));
      await refresh();
    }
  }

  // Fix Sudoers modal submit handler. Installs the NOPASSWD rule using a
  // one-time password and refreshes the table so the badge updates. Throws
  // on failure so the modal can surface the error inline without closing.
  async function handleFixSudoers(password: string) {
    if (!sudoersTarget) return;
    const result = await fixSudoers(sudoersTarget.id, password);
    await refresh();
    if (result.success) {
      setSudoersTarget(null);
    } else {
      throw new Error(result.message || 'Install failed');
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await importHostsCSV(file);
      setImportResult(result);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Host Management</h2>
          <p className="text-xs text-gray-500 mt-1">{hosts.length} hosts configured</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleImport}
            className="hidden"
          />
          <button
            onClick={downloadHostsTemplate}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm font-medium transition-colors"
            title="Download example CSV template"
          >
            <FileDown className="h-4 w-4" />
            Template
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm font-medium transition-colors"
          >
            <Upload className="h-4 w-4" />
            Import CSV
          </button>
          <button
            onClick={exportHostsCSV}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm font-medium transition-colors"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          {hosts.length > 0 && (
            <button
              onClick={() => setDeleteAllConfirm(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/40 hover:bg-red-900/70 border border-red-800/50 text-red-400 hover:text-red-300 text-sm font-medium transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              Delete All
            </button>
          )}
          <button
            onClick={openAddForm}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Host
          </button>
        </div>
      </div>

      {/* Import Result Banner */}
      {importResult && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-center justify-between">
          <div className="text-sm">
            <span className="text-emerald-400 font-medium">{importResult.created} imported</span>
            {importResult.skipped > 0 && (
              <span className="text-gray-400 ml-3">{importResult.skipped} skipped (duplicates)</span>
            )}
            {importResult.errors.length > 0 && (
              <span className="text-red-400 ml-3">{importResult.errors.length} errors</span>
            )}
          </div>
          <button onClick={() => setImportResult(null)} className="text-gray-500 hover:text-gray-300">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Error Banner */}
      {error && !showForm && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center justify-between">
          <span className="text-sm text-red-400">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Delete All Confirmation. Uses the shared ConfirmDialog component so
          centered modals have a single source of truth across the app
          (see BUG-003). */}
      <ConfirmDialog
        open={deleteAllConfirm}
        variant="danger"
        title="Delete All Hosts"
        message={
          <>
            <p>
              This will permanently delete all{' '}
              <span className="text-white font-medium">{hosts.length} hosts</span>{' '}
              and all associated data: scan history, patch audit history, Docker stack data, and Docker update logs.
            </p>
            <p className="text-yellow-400 mt-2 text-xs">Export any data you want to keep before confirming.</p>
            <p className="text-red-400 mt-2 font-medium">This cannot be undone.</p>
          </>
        }
        confirmLabel="Delete All Hosts"
        loading={deletingAll}
        onCancel={() => setDeleteAllConfirm(false)}
        onConfirm={async () => {
          setDeletingAll(true);
          try {
            await deleteAllHosts();
            setDeleteAllConfirm(false);
            refresh();
          } catch {
            setError('Failed to delete all hosts');
            setDeleteAllConfirm(false);
          } finally {
            setDeletingAll(false);
          }
        }}
      />

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg">
            <div className="flex items-center justify-between p-6 border-b border-gray-800">
              <h3 className="text-lg font-semibold">{editingHost ? 'Edit Host' : 'Add Host'}</h3>
              <button onClick={closeForm} className="text-gray-500 hover:text-gray-300">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Hostname</label>
                  <input
                    type="text"
                    value={formData.hostname}
                    onChange={e => setFormData({ ...formData, hostname: e.target.value })}
                    required
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
                    placeholder="web-server-01"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">IP Address</label>
                  <input
                    type="text"
                    value={formData.ip_address}
                    onChange={e => setFormData({ ...formData, ip_address: e.target.value })}
                    required
                    pattern="^(\d{1,3}\.){3}\d{1,3}$"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
                    placeholder="192.168.1.100"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">SSH Username</label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={e => setFormData({ ...formData, username: e.target.value })}
                    required
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
                    placeholder="root"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">OS Type</label>
                  <select
                    value={formData.os_type}
                    onChange={e => setFormData({ ...formData, os_type: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
                  >
                    {OS_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_patch_target}
                    onChange={e => setFormData({ ...formData, is_patch_target: e.target.checked })}
                    className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
                  />
                  Patch Target
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.has_docker}
                    onChange={e => setFormData({ ...formData, has_docker: e.target.checked })}
                    className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
                  />
                  Docker Enabled
                </label>
              </div>
              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-medium transition-colors"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editingHost ? 'Save Changes' : 'Add Host'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Fix Sudoers modal. One-time password install of the NOPASSWD rule.
          Password is never stored: sent once to backend, used for one SSH
          session, discarded. */}
      <FixSudoersModal
        open={sudoersTarget !== null}
        hostname={sudoersTarget?.hostname || ''}
        username={sudoersTarget?.username || ''}
        osType={sudoersTarget?.os_type || ''}
        onCancel={() => setSudoersTarget(null)}
        onConfirm={handleFixSudoers}
      />

      {/* Host Table */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-gray-500">
              <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider">Hostname</th>
              <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider">IP Address</th>
              <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider">Username</th>
              <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider">OS Type</th>
              <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider text-center">Docker</th>
              <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider text-center">Patch Target</th>
              <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider text-center">SSH Test</th>
              <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider text-center">Sudoers</th>
              <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider text-center">Held Back</th>
              <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {hosts.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                  <Server className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No hosts configured</p>
                  <p className="text-xs mt-1">Add a host or import from CSV to get started.</p>
                </td>
              </tr>
            ) : (
              hosts.map(host => (
                <tr key={host.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{host.hostname}</td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">{host.ip_address}</td>
                  <td className="px-4 py-3 text-gray-400">{host.username}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-300">
                      {OS_OPTIONS.find(o => o.value === host.os_type)?.label || host.os_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {host.has_docker ? (
                      <span className="text-emerald-400 text-xs">Yes</span>
                    ) : (
                      <span className="text-gray-600 text-xs">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {host.is_patch_target ? (
                      <span className="text-emerald-400 text-xs">Yes</span>
                    ) : (
                      <span className="inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        MONITOR ONLY
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {/* SSH Test indicator. Resolves in priority order:
                        1. In-flight test spinner.
                        2. Explicit test result from this session (green/red).
                        3. Persisted is_online from the last scan or test.
                        Previously only (1) and (2) were rendered, so hosts
                        never showed green/red until the user clicked the
                        icon. Backend now persists on scan and on Test, so
                        reading host.is_online gives a truthful default. */}
                    {sshStatus[host.id] === 'testing' ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400 mx-auto" />
                    ) : sshStatus[host.id] === 'success' || (sshStatus[host.id] === undefined && host.is_online) ? (
                      <button onClick={() => handleTestSSH(host.id)} title="Online. Click to retest">
                        <Wifi className="h-4 w-4 text-emerald-400 mx-auto" />
                      </button>
                    ) : sshStatus[host.id] === 'failed' || (sshStatus[host.id] === undefined && host.is_online === false && host.last_scan) ? (
                      <button onClick={() => handleTestSSH(host.id)} title="Offline or unreachable. Click to retry">
                        <WifiOff className="h-4 w-4 text-red-400 mx-auto" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleTestSSH(host.id)}
                        className="text-gray-500 hover:text-gray-300 transition-colors"
                        title="Not yet tested. Click to test SSH connection"
                      >
                        <Wifi className="h-4 w-4 mx-auto" />
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {/* Sudoers column. Root users show a slate ROOT badge
                        (no sudoers needed). Otherwise: green OK, amber Fix
                        (clickable to open FixSudoersModal), gray Unknown. */}
                    {host.username === 'root' ? (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-300 border border-slate-500/20 uppercase tracking-wider"
                        title="Connected as root. Sudoers not required."
                      >
                        <ShieldCheck className="h-3 w-3" /> Root
                      </span>
                    ) : host.sudoers_ok === true ? (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wider"
                        title="NOPASSWD sudoers rule installed and working"
                      >
                        <ShieldCheck className="h-3 w-3" /> OK
                      </span>
                    ) : host.sudoers_ok === false ? (
                      <button
                        onClick={() => setSudoersTarget(host)}
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wider hover:bg-amber-500/20 transition-colors"
                        title="Patching and reboots will fail. Click to install the sudoers rule."
                      >
                        <ShieldAlert className="h-3 w-3" /> Fix
                      </button>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-400 border border-gray-600/30 uppercase tracking-wider"
                        title="Not probed yet. Run a scan or click SSH Test."
                      >
                        <ShieldQuestion className="h-3 w-3" /> Unknown
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {/* Held-back packages count. Applies to apt/proxmox only; kali
                        and pacman never accumulate held-back packages. Drill in via
                        the host detail page to see the list and install. */}
                    {(host.os_type === 'apt' || host.os_type === 'proxmox') && host.held_back_packages.length > 0 ? (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wider"
                        title={`Held back last patch: ${host.held_back_packages.join(', ')}. Open the host to install.`}
                      >
                        <Cpu className="h-3 w-3" /> {host.held_back_packages.length}
                      </span>
                    ) : (
                      <span className="text-gray-600">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {deleteConfirm === host.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-xs text-red-400 mr-2">Delete?</span>
                        <button
                          onClick={() => handleDelete(host.id)}
                          className="p-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30"
                          title="Confirm delete"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="p-1 rounded bg-gray-700 text-gray-400 hover:bg-gray-600"
                          title="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        {host.username !== 'root' && host.sudoers_ok === false && (
                          <button
                            onClick={() => setSudoersTarget(host)}
                            className="p-1.5 rounded text-amber-400 hover:text-amber-300 hover:bg-gray-800 transition-colors"
                            title="Install sudoers rule (one-time password)"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => openEditForm(host)}
                          className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                          title="Edit host"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(host.id)}
                          className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors"
                          title="Delete host"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
