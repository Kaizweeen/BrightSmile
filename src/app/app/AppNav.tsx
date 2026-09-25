"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/app/requests", label: "Requests" },
  { href: "/app/schedule", label: "Schedule" },
  { href: "/app/new", label: "New" },
  { href: "/app/patients", label: "Patients" },
  { href: "/app/settings", label: "Settings" },
];

/** Bottom tab bar on phones, top bar on wider screens. The current page is marked with aria-current, not colour alone. */
export default function AppNav({ pending }: { pending: number }) {
  const path = usePathname();
  return (
    <nav aria-label="Dashboard" className="app-nav">
      {ITEMS.map((item) => {
        const active = path === item.href || path.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item${active ? " on" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
            {item.href === "/app/requests" && pending > 0 && (
              <span className="nav-badge">
                {pending > 99 ? "99+" : pending}
                <span className="sr-only"> waiting</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
