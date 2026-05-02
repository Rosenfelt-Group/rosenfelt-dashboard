"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const TABS = [
  { label: "Pipeline",   href: "/crm" },
  { label: "Leads",      href: "/crm/leads" },
  { label: "Contacts",   href: "/crm/contacts" },
  { label: "Businesses", href: "/crm/businesses" },
  { label: "Clients",    href: "/crm/clients" },
];

export function CRMNav() {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-0 border-b border-brand-border mb-6 overflow-x-auto">
      {TABS.map(tab => {
        const active = tab.href === "/crm"
          ? pathname === "/crm"
          : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={clsx(
              "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
              active
                ? "border-brand-orange text-brand-orange"
                : "border-transparent text-brand-muted hover:text-brand-black hover:border-brand-border"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
