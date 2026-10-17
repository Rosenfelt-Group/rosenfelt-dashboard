"use client";
import { PageHeader } from "@/components/ui";
import DirectoriesTab from "./DirectoriesTab";

export default function MarketingPage() {
  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8">
      <PageHeader title="Marketing" description="Directory listings and submissions" />
      <DirectoriesTab />
    </div>
  );
}
