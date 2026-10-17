"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { ALL_PERMISSIONS } from "@/lib/permissions";

/**
 * The signed-in user's permissions from /api/auth/me: null while loading, [] if
 * the lookup fails. Role "admin" gets every permission (matching the server's
 * hasPermission rule), so admins whose session predates a new permission still
 * see the UI for it.
 */
export function usePermissions(): string[] | null {
  const [perms, setPerms] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchJson<{ role?: string; permissions?: string[] }>("/api/auth/me").then(r => {
      if (cancelled) return;
      if (!r.ok) { setPerms([]); return; }
      const own = Array.isArray(r.data.permissions) ? r.data.permissions : [];
      setPerms(r.data.role === "admin" ? Array.from(new Set([...ALL_PERMISSIONS, ...own])) : own);
    });
    return () => { cancelled = true; };
  }, []);
  return perms;
}
