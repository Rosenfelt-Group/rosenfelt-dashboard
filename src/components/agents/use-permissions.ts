"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";

/** The signed-in user's permissions from /api/auth/me: null while loading, [] if the lookup fails. */
export function usePermissions(): string[] | null {
  const [perms, setPerms] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchJson<{ permissions?: string[] }>("/api/auth/me").then(r => {
      if (cancelled) return;
      setPerms(r.ok && Array.isArray(r.data.permissions) ? r.data.permissions : []);
    });
    return () => { cancelled = true; };
  }, []);
  return perms;
}
