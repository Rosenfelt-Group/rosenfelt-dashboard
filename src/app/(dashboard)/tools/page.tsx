"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchJson } from "@/lib/fetch-json";
import { can } from "@/lib/permissions";
import { EmptyState, ErrorState, LoadingState, PageHeader, Tabs } from "@/components/ui";
import { UsersPanel } from "@/components/admin/UsersPanel";
import { RolesPanel } from "@/components/admin/RolesPanel";
import { SqlPanel } from "@/components/admin/SqlPanel";
import { TerminalAdminPanel } from "@/components/admin/TerminalAdminPanel";

// Mirrors the server-side checks: /api/admin/users, /api/supabase/* and
// /api/terminal/token require the admin role; /api/admin/rbac requires manage_rbac.
const ALL_TABS = [
  { id: "users",    label: "Users",    access: "admin"       },
  { id: "roles",    label: "Roles",    access: "manage_rbac" },
  { id: "sql",      label: "SQL",      access: "admin"       },
  { id: "terminal", label: "Terminal", access: "admin"       },
] as const;
type Tab = typeof ALL_TABS[number]["id"];

function AdminShell() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [permsError, setPermsError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ permissions?: string[]; role?: string }>("/api/auth/me").then(r => {
      if (r.ok) { setPermissions(r.data?.permissions ?? []); setRole(r.data?.role ?? null); }
      else { setPermissions([]); setPermsError(r.error); }
    });
  }, []);

  if (permissions === null) {
    return (
      <div className="p-4 md:p-8 pb-24 md:pb-8">
        <PageHeader title="Admin" />
        <LoadingState />
      </div>
    );
  }

  const tabs = ALL_TABS.filter(t => (t.access === "admin" ? role === "admin" : can(permissions, t.access)));
  if (tabs.length === 0) {
    return (
      <div className="p-4 md:p-8 pb-24 md:pb-8">
        <PageHeader title="Admin" />
        {permsError
          ? <ErrorState message={`Couldn't load your permissions: ${permsError}`} />
          : <EmptyState title="You don't have access to any admin tools." />}
      </div>
    );
  }
  const raw = searchParams.get("tab");
  const active: Tab = tabs.find(t => t.id === raw)?.id ?? tabs[0].id;

  function setTab(id: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", id);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8">
      <PageHeader title="Admin" />
      <Tabs tabs={tabs} value={active} onChange={setTab} className="mb-5" />
      {permsError && (
        <ErrorState message={`Couldn't load your permissions (${permsError}); some tabs may be hidden.`} className="mb-4" />
      )}
      {active === "users"    && <UsersPanel />}
      {active === "roles"    && <RolesPanel />}
      {active === "sql"      && <SqlPanel />}
      {active === "terminal" && <TerminalAdminPanel />}
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="p-8"><LoadingState /></div>}>
      <AdminShell />
    </Suspense>
  );
}
