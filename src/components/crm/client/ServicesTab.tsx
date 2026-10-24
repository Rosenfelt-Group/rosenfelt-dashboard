"use client";
import clsx from "clsx";
import { Button, EmptyState } from "@/components/ui";
import type { ClientService, ClientServiceStatus } from "@/types";

const STATUS_PILL: Record<ClientServiceStatus, string> = {
  pending_activation: "bg-gray-100 text-gray-600",
  active:             "bg-green-100 text-green-700",
  paused:             "bg-yellow-100 text-yellow-800",
  cancelled:          "bg-red-100 text-red-700",
};

export function ServicesTab({
  services,
  onAdd,
  onActivate,
  onEdit,
  onCancel,
  onInvoice,
}: {
  services: ClientService[];
  onAdd: () => void;
  onActivate: (s: ClientService) => void;
  onEdit: (s: ClientService) => void;
  onCancel: (s: ClientService) => void;
  onInvoice: (s: ClientService) => void;
}) {
  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <div className="text-xs text-brand-muted">
          {services.length === 0 ? "No services yet" : `${services.length} service${services.length === 1 ? "" : "s"}`}
        </div>
        <Button size="sm" onClick={onAdd}>+ Add service</Button>
      </div>
      {services.length === 0 ? (
        <EmptyState title={'Click "Add service" to attach a service from the catalog.'} />
      ) : (
        <div className="space-y-3">
          {services.map((s) => {
            const tmpl = s.service_template;
            const rate = s.monthly_rate ?? s.project_rate ?? s.hourly_rate;
            const rateLabel = s.monthly_rate != null
              ? `$${s.monthly_rate}/mo`
              : s.hourly_rate != null
                ? `$${s.hourly_rate}/hr`
                : s.project_rate != null
                  ? `$${s.project_rate}`
                  : "rate not set";
            return (
              <div key={s.id} className="card">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm font-medium text-brand-black">{tmpl?.name ?? "(unknown service)"}</div>
                    <div className="text-xs text-brand-muted mt-0.5 flex flex-wrap items-center gap-2">
                      <span className={clsx("inline-flex rounded-full px-2 py-0.5 text-[11px]", STATUS_PILL[s.status])}>
                        {s.status.replace("_", " ")}
                      </span>
                      <span>{rateLabel}</span>
                      {s.billing_start_date && <span>· starts {s.billing_start_date}</span>}
                      {s.stripe_subscription_status && (
                        <span className="text-[11px]">· stripe: {s.stripe_subscription_status}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.status === "pending_activation" && rate != null && (
                      <Button size="sm" onClick={() => onActivate(s)}>
                        Activate billing
                      </Button>
                    )}
                    {s.status === "active" && tmpl?.billing_type === "tm" && (
                      <Button variant="secondary" size="sm" onClick={() => onInvoice(s)}>
                        Invoice now
                      </Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => onEdit(s)}>
                      Edit
                    </Button>
                    {s.status !== "cancelled" && (
                      <button
                        onClick={() => onCancel(s)}
                        className="text-xs px-3 py-1.5 rounded border border-brand-border hover:bg-red-50 hover:border-red-200 hover:text-red-700"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
