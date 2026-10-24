import Link from "next/link";
import clsx from "clsx";
import { format } from "date-fns";
import { CRMLead, CRMAssessmentResult, DiscoveryInvite } from "@/types";
import { STATUS_META } from "@/lib/discovery";

const TIER_LABELS: Record<string, string> = {
  foundation_first: "Foundation First",
  getting_there: "Getting There",
  ready_light_prep: "Ready with Light Prep",
  ready_to_move: "Ready to Move",
};

export function BusinessCard({ business }: { business: NonNullable<CRMLead["business"]> }) {
  return (
    <div className="card">
      <h3 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-3">Business</h3>
      <Link href={`/crm/organizations/${business.id}`} className="text-sm font-medium text-brand-orange hover:underline">
        {business.name}
      </Link>
      {business.industry && (
        <p className="text-xs text-brand-muted mt-1">{business.industry}</p>
      )}
      {business.size && (
        <p className="text-xs text-brand-muted">{business.size} employees</p>
      )}
      {business.website && (
        <a href={business.website} target="_blank" rel="noopener noreferrer"
          className="text-xs text-brand-orange hover:underline block mt-1">
          {business.website}
        </a>
      )}
    </div>
  );
}

export function ContactCard({
  contact,
  contactName,
  linkedinUrl,
}: {
  contact: NonNullable<CRMLead["contact"]>;
  contactName: string;
  linkedinUrl: string | null | undefined;
}) {
  return (
    <div className="card">
      <h3 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-3">Contact</h3>
      <p className="text-sm font-medium text-brand-black">{contactName}</p>
      {contact.title && <p className="text-xs text-brand-muted">{contact.title}</p>}
      {contact.email && (
        <p className="text-xs text-brand-orange mt-1">{contact.email}</p>
      )}
      {contact.phone && (
        <p className="text-xs text-brand-muted">{contact.phone}</p>
      )}
      {linkedinUrl && (
        <a href={linkedinUrl} target="_blank" rel="noopener noreferrer"
          className="text-xs text-brand-orange hover:underline block mt-1">
          LinkedIn ↗
        </a>
      )}
    </div>
  );
}

export function DiscoveryCard({ leadId, discovery }: { leadId: string; discovery: DiscoveryInvite[] }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-brand-muted uppercase tracking-wide">Discovery</h3>
        <Link href={`/crm/discovery?new=1&lead_id=${leadId}`} className="text-xs text-brand-orange hover:underline">+ New</Link>
      </div>
      {discovery.length === 0 ? (
        <p className="text-xs text-brand-muted">No questionnaire sent yet.</p>
      ) : (
        <div className="space-y-2">
          {discovery.map(inv => (
            <Link key={inv.id} href={`/crm/discovery/${inv.id}`} className="block group">
              <p className="text-sm text-brand-black group-hover:text-brand-orange truncate">{inv.project_title}</p>
              <span className={clsx("badge text-xs mt-0.5", STATUS_META[inv.status].color)}>{STATUS_META[inv.status].label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function AssessmentCard({ assessment }: { assessment: CRMAssessmentResult }) {
  return (
    <div className="card">
      <h3 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-3">Assessment</h3>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-2xl font-bold text-brand-black">{assessment.score}</span>
        <span className="text-xs text-brand-muted">/ 25</span>
      </div>
      <span className="badge badge-orange text-xs">{TIER_LABELS[assessment.tier] ?? assessment.tier}</span>
      {assessment.section_breakdown && (
        <div className="mt-3 space-y-1">
          {Object.entries(assessment.section_breakdown).map(([section, score]) => (
            <div key={section} className="flex justify-between text-xs text-brand-muted">
              <span className="capitalize">{section}</span>
              <span className="font-medium text-brand-black">{score}/5</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DetailsCard({ lead }: { lead: CRMLead }) {
  return (
    <div className="card">
      <h3 className="text-xs font-medium text-brand-muted uppercase tracking-wide mb-3">Details</h3>
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-brand-muted">Created</span>
          <span className="text-brand-black">{format(new Date(lead.created_at), "MMM d, yyyy")}</span>
        </div>
        {lead.lost_reason && (
          <div>
            <span className="text-brand-muted block">Lost reason</span>
            <span className="text-brand-black">{lead.lost_reason}</span>
          </div>
        )}
      </div>
    </div>
  );
}
