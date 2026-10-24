"use client";
import { Button, EmptyState } from "@/components/ui";
import type { ClientService, TmBillingEntry } from "@/types";

export function TmTab({
  services,
  entries,
  onLog,
  onGenerateInvoice,
}: {
  services: ClientService[];
  entries: TmBillingEntry[];
  onLog: () => void;
  onGenerateInvoice: (serviceId: string) => void;
}) {
  const unbilled = entries.filter((e) => !e.billed);
  return (
    <>
      <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
        <div className="text-xs text-brand-muted">
          {entries.length} entr{entries.length === 1 ? "y" : "ies"} · {unbilled.length} unbilled
        </div>
        <div className="flex items-center gap-2">
          {services.map((s) => (
            <Button key={s.id} variant="secondary" size="sm" onClick={() => onGenerateInvoice(s.id)}>
              Generate invoice ({s.service_template?.name})
            </Button>
          ))}
          <Button size="sm" onClick={onLog}>+ Log hours</Button>
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState title="No T&M entries yet." />
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-xs">
            <thead className="bg-brand-cream/40 text-brand-muted uppercase tracking-wide">
              <tr>
                <th className="text-left py-2 px-3 font-medium">Date</th>
                <th className="text-left py-2 px-3 font-medium">Service</th>
                <th className="text-left py-2 px-3 font-medium">Hours</th>
                <th className="text-left py-2 px-3 font-medium">Description</th>
                <th className="text-left py-2 px-3 font-medium">By</th>
                <th className="text-left py-2 px-3 font-medium">Billed</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const svc = services.find((s) => s.id === e.client_service_id);
                return (
                  <tr key={e.id} className="border-t border-brand-border">
                    <td className="py-2 px-3">{e.entry_date}</td>
                    <td className="py-2 px-3">{svc?.service_template?.name ?? "—"}</td>
                    <td className="py-2 px-3">{e.hours}</td>
                    <td className="py-2 px-3">{e.description}</td>
                    <td className="py-2 px-3">{e.logged_by}</td>
                    <td className="py-2 px-3">
                      {e.billed
                        ? <span className="inline-flex rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[11px]">Billed</span>
                        : <span className="inline-flex rounded-full bg-gray-100 text-gray-600 px-2 py-0.5 text-[11px]">Unbilled</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
