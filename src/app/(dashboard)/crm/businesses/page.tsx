"use client";
import { useEffect, useState } from "react";
import { CRMBusiness } from "@/types";
import Link from "next/link";
import { CRMNav } from "@/components/CRMNav";

export default function BusinessesPage() {
  const [businesses, setBusinesses] = useState<CRMBusiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/crm/businesses")
      .then(r => r.json())
      .then(d => { setBusinesses(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);

  const filtered = businesses.filter(b =>
    !search || b.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 md:p-8 max-w-4xl pb-24 md:pb-8">
      <CRMNav />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Businesses</h1>
          <p className="text-sm text-brand-muted mt-0.5">{businesses.length} total</p>
        </div>
      </div>

      <div className="mb-4">
        <input
          className="w-full max-w-sm border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
          placeholder="Search by name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="card animate-pulse h-40" />
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-brand-muted text-sm">{search ? "No businesses match." : "No businesses yet."}</p>
        </div>
      ) : (
        <div className="card divide-y divide-brand-border">
          {filtered.map(biz => (
            <div key={biz.id} className="py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-brand-black">{biz.name}</p>
                {biz.industry && <p className="text-xs text-brand-muted">{biz.industry}</p>}
                {biz.website && (
                  <a href={biz.website} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-brand-orange hover:underline">{biz.website}</a>
                )}
              </div>
              <div className="text-right shrink-0 space-y-1">
                {biz.size && <p className="text-xs text-brand-muted">{biz.size} employees</p>}
                {biz.source && (
                  <span className="badge badge-neutral text-xs capitalize">
                    {biz.source.replace("_", " ")}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
