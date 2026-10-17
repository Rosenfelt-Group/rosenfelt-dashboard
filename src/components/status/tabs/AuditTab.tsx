"use client";
import RegressionPanel from "@/components/status/RegressionPanel";
import AlignmentAuditPanel from "@/components/status/AlignmentAuditPanel";

export function AuditTab({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="space-y-8">
      <AlignmentAuditPanel isAdmin={isAdmin} />
      <div>
        <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide mb-4">Regression Tests</p>
        <RegressionPanel isAdmin={isAdmin} />
      </div>
    </div>
  );
}
