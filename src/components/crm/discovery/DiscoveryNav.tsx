"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const LINKS = [
  { href: "/crm/discovery", label: "Questionnaires" },
  { href: "/crm/discovery/templates", label: "Templates" },
  { href: "/crm/discovery/questions", label: "Question bank" },
];

export function DiscoveryNav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 mb-4 border-b border-brand-border overflow-x-auto no-scrollbar [-webkit-overflow-scrolling:touch]">
      {LINKS.map(l => {
        const active = l.href === "/crm/discovery"
          ? !path.startsWith("/crm/discovery/templates") && !path.startsWith("/crm/discovery/questions")
          : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}
            className={clsx(
              "px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
              active
                ? "border-brand-orange text-brand-orange"
                : "border-transparent text-brand-muted hover:text-brand-black",
            )}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
