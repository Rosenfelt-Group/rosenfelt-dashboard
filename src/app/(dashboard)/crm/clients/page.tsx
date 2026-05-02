"use client";
import { useEffect, useState } from "react";
import { CRMClient } from "@/types";
import Link from "next/link";
import clsx from "clsx";
import { AgentBadge } from "@/components/AgentBadge";
import { Agent } from "@/types";

const TIER_LABELS: Record<string, string> = {
  newsroom: "Newsroom",
  operations: "Operations",
  finance_ops: "Finance Ops",
  growth_stack: "Growth Stack",
  full_stack: "Full Stack",
};

const STATUS_COLORS: Record<string, string> = {
  active: "badge-success",
  paused: "badge-warning",
  cancelled: "badge-error",
};

export default function ClientsPage() {
  const [clients, setClients] = useState<CRMClient[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/crm/clients")
      .then(r => r.json())
      .then(d => { setClients(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">
      <div className="mb-2">
        <Link href="/crm" className="text-xs text-brand-muted hover:text-brand-black">← Pipeline</Link>
      </div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-brand-black">Clients</h1>
        <p className="text-sm text-brand-muted mt-0.5">{clients.length} active retainers</p>
      </div>

      {loading ? (
        <div className="card animate-pulse h-40" />
      ) : clients.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-brand-muted text-sm">No clients yet.</p>
          <p className="text-xs text-brand-muted mt-1">Convert a won lead to create the first client record.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {clients.map(client => (
            <div key={client.id} className="card">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm font-medium text-brand-black">{client.business?.name ?? "—"}</p>
                  {client.contact && (
                    <p className="text-xs text-brand-muted mt-0.5">
                      {client.contact.first_name}{client.contact.last_name ? " " + client.contact.last_name : ""}
                      {client.contact.email ? ` · ${client.contact.email}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={clsx("badge text-xs", STATUS_COLORS[client.billing_status] ?? "badge-neutral")}>
                    {client.billing_status}
                  </span>
                  {client.service_tier && (
                    <span className="badge badge-orange text-xs">{TIER_LABELS[client.service_tier] ?? client.service_tier}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-brand-border text-xs text-brand-muted flex-wrap">
                {client.monthly_value && (
                  <span>
                    <span className="text-brand-black font-medium">${client.monthly_value.toLocaleString()}</span>/mo
                  </span>
                )}
                {client.contract_start && (
                  <span>Started {client.contract_start}</span>
                )}
                {client.contract_end && (
                  <span>Ends {client.contract_end}</span>
                )}
                {client.assigned_agents && client.assigned_agents.length > 0 && (
                  <div className="flex items-center gap-1 ml-auto">
                    {client.assigned_agents.map(agent => (
                      <AgentBadge key={agent} agent={agent as Agent} size="sm" />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
