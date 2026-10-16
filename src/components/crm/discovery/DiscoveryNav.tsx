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
    <div className="flex gap-2 mb-4 flex-wrap">
      {LINKS.map(l => {
        const active = l.href === "/crm/discovery"
          ? !path.startsWith("/crm/discovery/templates") && !path.startsWith("/crm/discovery/questions")
          : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href}
            className={clsx("badge cursor-pointer", active ? "bg-brand-black text-white" : "badge-neutral")}>
            {l.label}
          </Link>
        );
      })}
    </div>
  );
}
