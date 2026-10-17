"use client";
import DirectoriesTab from "./DirectoriesTab";

export default function MarketingPage() {
  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-brand-black">Marketing</h1>
        <p className="text-sm text-brand-muted mt-0.5">Directory listings and submissions</p>
      </div>
      <DirectoriesTab />
    </div>
  );
}
