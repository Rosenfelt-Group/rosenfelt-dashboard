"use client";
// Named slots on the organization page for work that lands after this page (stream R and wave 2).
// Each one is the single place to wire the new component in; the page already renders all of them.
import { OrgResearchList } from "./OrgResearchList";

/**
 * Header actions after Edit. WAVE 2: render the "Merge…" and "Delete…" buttons here
 * (merge: /api/crm/merge/**, delete: /api/crm/delete/**). `name` is for the type-the-name delete confirm.
 */
export function OrgHeaderActionsSlot(_props: { businessId: string; name: string; onChanged: () => void }) {
  return null;
}

/** Under the header. WAVE 2: the "Possible duplicates" banner (/api/crm/duplicates/**) goes here. */
export function OrgDuplicateBannerSlot(_props: { businessId: string; onChanged: () => void }) {
  return null;
}

/**
 * Research tab body.
 * TODO(stream R): replace the body with
 *   import { OrgResearchTab } from "@/components/crm/research/OrgResearchTab";
 *   return <OrgResearchTab businessId={businessId} />;
 * and delete OrgResearchList.tsx if nothing else uses it.
 */
export function OrgResearchSlot({ businessId }: { businessId: string }) {
  return <OrgResearchList businessId={businessId} />;
}

/**
 * Inside the Engagement tab's scope card, under the client view.
 * TODO(stream R): return <ScopeResearchInputs businessId={businessId} scopeId={scopeId} />
 * from "@/components/crm/research/ScopeResearchInputs".
 */
export function ScopeResearchInputsSlot(_props: { businessId: string; scopeId: string }) {
  return null;
}
