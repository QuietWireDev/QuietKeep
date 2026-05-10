// QuietKeep: TagManagement.tsx
// Tag CRUD UI for Settings page. Create, rename, recolor, and delete tags.
// Author: QuietWire (Dennis Ayotte)

import { useState } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import type { Tag } from '../types';
import { useTags, createTag, updateTag, deleteTag } from '../hooks/useApi';
import ConfirmDialog from './ConfirmDialog';

const PRESET_COLORS = [
  '#6b7280', '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4',
];

export default function TagManagement() {
  const { tags, loading, refresh } = useTags();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createTag(newName.trim(), newColor);
      setNewName('');
      setNewColor(PRESET_COLORS[0]);
      refresh();
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEdit = async (tag: Tag) => {
    const changes: { name?: string; color?: string } = {};
    if (editName.trim() && editName.trim() !== tag.name) changes.name = editName.trim();
    if (editColor !== tag.color) changes.color = editColor;
    if (Object.keys(changes).length > 0) {
      await updateTag(tag.id, changes);
      refresh();
    }
    setEditingId(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteTag(deleteTarget.id);
    setDeleteTarget(null);
    refresh();
  };

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Tags</h2>
        <p className="text-xs text-gray-500 mt-1">Organize hosts by role, location, or environment</p>
      </div>

      {/* Create new tag */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold mb-3">New Tag</h3>
        <div className="flex items-center gap-3">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="Tag name..."
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
          />
          <div className="flex items-center gap-1">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={`w-5 h-5 rounded-full border-2 transition-all ${
                  newColor === c ? 'border-white scale-125' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create
          </button>
        </div>
      </div>

      {/* Existing tags */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            {tags.length} Tag{tags.length !== 1 ? 's' : ''}
          </span>
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-gray-600" />
          </div>
        ) : tags.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-600">
            No tags yet. Create one above.
          </div>
        ) : (
          <div className="divide-y divide-gray-800/50">
            {tags.map(tag => (
              <div key={tag.id} className="flex items-center gap-3 px-5 py-3">
                {editingId === tag.id ? (
                  <>
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(tag); if (e.key === 'Escape') setEditingId(null); }}
                      className="flex-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-emerald-500"
                      autoFocus
                    />
                    <div className="flex items-center gap-1">
                      {PRESET_COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => setEditColor(c)}
                          className={`w-4 h-4 rounded-full border-2 transition-all ${
                            editColor === c ? 'border-white scale-125' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <button
                      onClick={() => handleSaveEdit(tag)}
                      className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-xs text-gray-500 hover:text-gray-300"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    <span
                      className="text-sm font-medium flex-1 cursor-pointer hover:text-emerald-400 transition-colors"
                      onClick={() => { setEditingId(tag.id); setEditName(tag.name); setEditColor(tag.color); }}
                    >
                      {tag.name}
                    </span>
                    <button
                      onClick={() => setDeleteTarget(tag)}
                      className="text-gray-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Tag"
        message={`Delete "${deleteTarget?.name}"? It will be removed from all hosts.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
