"use client";
import { useEffect, useState, useCallback } from "react";
import { DashboardRole } from "@/types";
import {
  ALL_PERMISSIONS,
  PERMISSION_LABELS,
  VIEW_PERMISSIONS,
  MANAGE_PERMISSIONS,
} from "@/lib/permissions";
import clsx from "clsx";

// ─── Create role modal ────────────────────────────────────────────────────────

function CreateRoleModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/rbac", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, permissions: [] }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-brand-black">Create role</h2>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-black text-lg leading-none">×</button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-brand-black mb-1">
              Name <span className="text-red-500">*</span>
              <span className="font-normal text-brand-muted ml-1">(lowercase, no spaces)</span>
            </label>
            <input
              required
              pattern="[a-z0-9_-]+"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. operator"
              className="w-full text-sm px-3 py-2 border border-brand-border rounded-lg
                         focus:outline-none focus:border-brand-orange font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-black mb-1">Description</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What can this role do?"
              className="w-full text-sm px-3 py-2 border border-brand-border rounded-lg
                         focus:outline-none focus:border-brand-orange"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-brand-muted border border-brand-border
                         rounded-lg hover:text-brand-black transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium bg-brand-orange text-white rounded-lg
                         hover:bg-brand-orange-dark transition-colors disabled:opacity-50"
            >
              {saving ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Permission matrix ────────────────────────────────────────────────────────

type SaveState = "idle" | "saving" | "saved" | "error";

function PermissionMatrix({
  roles,
  onChange,
}: {
  roles: DashboardRole[];
  onChange: (roleName: string, permission: string, value: boolean) => Promise<void>;
}) {
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});

  async function toggle(roleName: string, permission: string, current: boolean) {
    const key = `${roleName}:${permission}`;
    setSaveStates(s => ({ ...s, [key]: "saving" }));
    try {
      await onChange(roleName, permission, !current);
      setSaveStates(s => ({ ...s, [key]: "saved" }));
      setTimeout(() => setSaveStates(s => { const n = { ...s }; delete n[key]; return n; }), 1200);
    } catch {
      setSaveStates(s => ({ ...s, [key]: "error" }));
    }
  }

  const groups = [
    { label: "View", permissions: VIEW_PERMISSIONS as readonly string[] },
    { label: "Manage", permissions: MANAGE_PERMISSIONS as readonly string[] },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="text-left px-4 py-3 text-xs font-medium text-brand-muted bg-brand-offwhite
                           border-b border-brand-border w-52 sticky left-0 z-10">
              Permission
            </th>
            {roles.map(role => (
              <th key={role.name}
                  className="px-4 py-3 text-center border-b border-brand-border bg-brand-offwhite min-w-[110px]">
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-xs font-semibold text-brand-black capitalize">{role.name}</span>
                  {role.is_system && (
                    <span className="text-[10px] text-brand-muted">system</span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(group => (
            <>
              <tr key={group.label}>
                <td colSpan={roles.length + 1}
                    className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider
                               text-brand-muted bg-brand-offwhite/50 border-b border-brand-border">
                  {group.label}
                </td>
              </tr>
              {group.permissions.map(permission => (
                <tr key={permission} className="border-b border-brand-border last:border-0 hover:bg-brand-offwhite/30">
                  <td className="px-4 py-2.5 text-xs text-brand-black sticky left-0 bg-white z-10
                                 border-r border-brand-border">
                    {PERMISSION_LABELS[permission as keyof typeof PERMISSION_LABELS] ?? permission}
                    <span className="block text-[10px] text-brand-muted font-mono mt-0.5">{permission}</span>
                  </td>
                  {roles.map(role => {
                    const checked = role.permissions.includes(permission);
                    const key = `${role.name}:${permission}`;
                    const state = saveStates[key] ?? "idle";
                    return (
                      <td key={role.name} className="px-4 py-2.5 text-center">
                        <label className={clsx(
                          "inline-flex items-center justify-center cursor-pointer",
                          role.is_system && "cursor-not-allowed opacity-60",
                        )}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={role.is_system || state === "saving"}
                            onChange={() => toggle(role.name, permission, checked)}
                            className="w-4 h-4 accent-brand-orange"
                          />
                        </label>
                        {state === "saving" && (
                          <span className="block text-[10px] text-brand-muted mt-0.5">saving…</span>
                        )}
                        {state === "saved" && (
                          <span className="block text-[10px] text-green-600 mt-0.5">✓</span>
                        )}
                        {state === "error" && (
                          <span className="block text-[10px] text-red-600 mt-0.5">err</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function RBACPage() {
  const [roles, setRoles] = useState<DashboardRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/rbac");
    if (!res.ok) { setError("Failed to load roles"); setLoading(false); return; }
    setRoles(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function togglePermission(roleName: string, permission: string, value: boolean) {
    const role = roles.find(r => r.name === roleName);
    if (!role) return;
    const newPerms = value
      ? [...role.permissions, permission]
      : role.permissions.filter(p => p !== permission);

    // Optimistic update
    setRoles(prev => prev.map(r => r.name === roleName ? { ...r, permissions: newPerms } : r));

    const res = await fetch("/api/admin/rbac", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: roleName, permissions: newPerms }),
    });
    if (!res.ok) {
      // Revert on failure
      setRoles(prev => prev.map(r => r.name === roleName ? { ...r, permissions: role.permissions } : r));
      throw new Error("Failed to save");
    }
  }

  async function deleteRole(name: string) {
    setDeleting(name);
    const res = await fetch("/api/admin/rbac", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setDeleting(null);
    setConfirmDelete(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to delete role");
      return;
    }
    setRoles(prev => prev.filter(r => r.name !== name));
  }

  if (loading) {
    return (
      <div className="p-4 md:p-8 space-y-4">
        <div className="h-8 w-40 bg-brand-border rounded animate-pulse" />
        <div className="card animate-pulse h-64" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 pt-16 md:pt-8 pb-24 md:pb-8 max-w-5xl space-y-5">
      {showCreate && (
        <CreateRoleModal onClose={() => setShowCreate(false)} onCreated={load} />
      )}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Roles</h1>
          <p className="text-sm text-brand-muted mt-0.5">
            {roles.length} role{roles.length !== 1 ? "s" : ""} · permission changes take effect on next login
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-brand-orange text-white
                     hover:bg-brand-orange-dark transition-colors flex items-center gap-1.5"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Create role
        </button>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" className="flex-shrink-0 mt-0.5">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>
          Permission changes are embedded in the JWT at login.
          Users must <strong>sign out and back in</strong> to pick up updated role permissions.
          System roles (admin, viewer) cannot be deleted, but their permissions can be edited.
        </span>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 px-4 py-3 rounded-lg">{error}</div>
      )}

      {/* Permission matrix */}
      <div className="card p-0 overflow-hidden">
        <PermissionMatrix roles={roles} onChange={togglePermission} />
      </div>

      {/* Role management (descriptions + delete) */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-brand-black">Role details</h2>
        <div className="card p-0 overflow-hidden divide-y divide-brand-border">
          {roles.map(role => (
            <div key={role.name} className="flex items-center gap-4 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-brand-black capitalize font-mono">{role.name}</span>
                  {role.is_system && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-offwhite text-brand-muted border border-brand-border">
                      system
                    </span>
                  )}
                </div>
                <p className="text-xs text-brand-muted mt-0.5 truncate">{role.description || "No description"}</p>
              </div>
              <span className="text-xs text-brand-muted flex-shrink-0">
                {role.permissions.length} / {ALL_PERMISSIONS.length} permissions
              </span>
              {!role.is_system && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  {confirmDelete === role.name ? (
                    <>
                      <span className="text-xs text-brand-muted">Delete {role.name}?</span>
                      <button
                        onClick={() => deleteRole(role.name)}
                        disabled={deleting === role.name}
                        className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                      >
                        {deleting === role.name ? "…" : "Yes, delete"}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-xs px-2 py-1 rounded bg-brand-offwhite text-brand-muted hover:bg-brand-border transition-colors"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(role.name)}
                      className="text-xs text-brand-muted hover:text-red-600 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
