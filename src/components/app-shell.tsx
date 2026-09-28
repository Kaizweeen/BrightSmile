"use client";

import { ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserMenu } from "@/components/user-menu";
import type { NavItem } from "@/lib/nav";
import { withBranch } from "@/lib/paths";
import { cn } from "@/lib/utils";

type Props = {
  practice: string;
  branch: string;
  branches: { code: string; name: string }[];
  nav: NavItem[];
  user: { name: string; role: string };
  children: React.ReactNode;
};

/** Header with the branch switcher, the navigation, and the account menu (spec section 10). */
export function AppShell({ practice, branch, branches, nav, user, children }: Props) {
  const pathname = usePathname();
  const here = branches.find((b) => b.code === branch)?.name ?? branch;
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
          <Link href="/" className="font-semibold">
            {practice}
          </Link>
          {/* A menu of links rather than a select, so arrowing through the branches never leaves the page (WCAG 3.2.2). */}
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(buttonVariants({ variant: "outline" }), "w-44 justify-between")}>
              <span className="truncate">
                <span className="sr-only">Branch: </span>
                {here}
              </span>
              <ChevronDownIcon aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {branches.map((b) => (
                <DropdownMenuItem key={b.code} render={<Link href={withBranch(pathname, b.code)} />} aria-current={b.code === branch ? "page" : undefined}>
                  {b.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <nav aria-label="Main" className="order-last -mx-1 flex w-full gap-1 overflow-x-auto md:order-none md:mx-0 md:w-auto">
            {nav.map((item) => {
              const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "inline-flex h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium sm:h-9",
                    current ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto">
            <UserMenu name={user.name} role={user.role} />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
