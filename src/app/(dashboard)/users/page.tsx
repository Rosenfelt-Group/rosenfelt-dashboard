"use client";
import { useEffect, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import clsx from "clsx";

type Role = "admin" | "viewer";

interface DashboardUser {
  id: string;
  username: string;
  role: Role;
  created_at: string;
}

function RoleBadge({ role }: { role: Role }) {
  return (
    <span className={clsx(
      "text-xs px-2 py-0.5 rounded font-medium",
      role === "admin" ? "bg-orange-50 text-brand-orange" : "bg-gray-100 text-brand-muted"
    )}>
      {role}
    </span>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Add user form
  const [showAdd, setShowAdd] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("viewer");
  const [addError, setAddError] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  // Inline password reset state: userId → new password value
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [resetSaving, setResetSaving] = useState<Record<string, boolean>>({});

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/users");
    if (!res.ok) { setError("Failed to load users"); setLoading(false); return; }
    setUsers(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    setAddSaving(true);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
    });
    setAddSaving(false);
    if (!res.ok) {
      const data = await res.json();
      setAddError(data.error ?? "Failed to create user");
      return;
    }
    setNewUsername(""); setNewPassword(""); setNewRole("viewer"); setShowAdd(false);
    load();
  }

  async function handleRoleChange(id: string, role: Role) {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, role } : u));
    await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
  }

  async function handleResetPassword(id: string) {
    const password = resetPasswords[id];
    if (!password) return;
    setResetSaving(prev => ({ ...prev, [id]: true }));
    await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setResetSaving(prev => ({ ...prev, [id]: false }));
    setResetPasswords(prev => { const n = { ...prev }; delete n[id]; return n; });
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Delete failed");
      return;
    }
    setConfirmDelete(null);
    setUsers(prev => prev.filter(u => u.id !== id));
  }

  if (loading) {
    return (
      <div className="p-4 md:p-8 space-y-4">
        <div className="card animate-pulse h-16" />
        <div className="card animate-pulse h-48" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8 max-w-3xl space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Users</h1>
          <p className="text-sm text-brand-muted mt-0.5">{users.length} dashboard user{users.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => { setShowAdd(v => !v); setAddError(""); }}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-orange text-white hover:opacity-90 transition-opacity"
        >
          {showAdd ? "Cancel" : "+ Add user"}
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 px-4 py-3 rounded-lg">{error}</div>
      )}

      {/* Add user form */}
      {showAdd && (
        <form onSubmit={handleAddUser} className="card space-y-3">
          <p className="text-sm font-medium text-brand-black">New user</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              required
              placeholder="Username"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              className="border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/30"
            />
            <input
              required
              type="password"
              placeholder="Password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/30"
            />
            <select
              value={newRole}
              onChange={e => setNewRole(e.target.value as Role)}
              className="border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/30"
            >
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>
          </div>
          {addError && <p className="text-xs text-red-600">{addError}</p>}
          <button
            type="submit"
            disabled={addSaving}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-brand-orange text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {addSaving ? "Creating..." : "Create user"}
          </button>
        </form>
      )}

      {/* Users table */}
      <div className="card p-0 overflow-hidden">
        {users.length === 0 ? (
          <div className="py-12 text-center text-sm text-brand-muted">No users found</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-border bg-brand-offwhite">
                <th className="text-left px-4 py-3 text-xs font-medium text-brand-muted">Username</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-brand-muted">Role</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-brand-muted hidden sm:table-cell">Added</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-brand-muted">Password</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-brand-border last:border-0">
                  <td className="px-4 py-3 font-medium text-brand-black">{user.username}</td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      onChange={e => handleRoleChange(user.id, e.target.value as Role)}
                      className="text-xs border border-brand-border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-orange/30"
                    >
                      <option value="viewer">viewer</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-brand-muted hidden sm:table-cell">
                    {formatDistanceToNow(parseISO(user.created_at), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="password"
                        placeholder="New password"
                        value={resetPasswords[user.id] ?? ""}
                        onChange={e => setResetPasswords(prev => ({ ...prev, [user.id]: e.target.value }))}
                        className="text-xs border border-brand-border rounded px-2 py-1 w-32 focus:outline-none focus:ring-2 focus:ring-brand-orange/30"
                      />
                      {resetPasswords[user.id] && (
                        <button
                          onClick={() => handleResetPassword(user.id)}
                          disabled={resetSaving[user.id]}
                          className="text-xs px-2 py-1 rounded bg-brand-offwhite text-brand-black hover:bg-brand-border transition-colors disabled:opacity-50"
                        >
                          {resetSaving[user.id] ? "..." : "Save"}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {confirmDelete === user.id ? (
                      <div className="flex items-center gap-2 justify-end">
                        <span className="text-xs text-brand-muted">Sure?</span>
                        <button
                          onClick={() => handleDelete(user.id)}
                          className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="text-xs px-2 py-1 rounded bg-brand-offwhite text-brand-muted hover:bg-brand-border transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(user.id)}
                        className="text-xs text-brand-muted hover:text-red-600 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
