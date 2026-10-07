"use client";

import { Building2, CalendarDays, ChevronsUpDownIcon, Clock, LayoutDashboard, type LucideIcon, MenuIcon, Package, Receipt, Settings, Sun, UserCog, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogoGlyph } from "@/components/logo-glyph";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { UserMenu } from "@/components/user-menu";
import { Button } from "@/components/ui/button";
import type { NavIcon, NavItem } from "@/lib/nav";
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

const ICONS: Record<NavIcon, LucideIcon> = {
  overview: LayoutDashboard,
  calendar: CalendarDays,
  "my-day": Sun,
  patients: Users,
  billing: Receipt,
  supplies: Package,
  staff: UserCog,
  settings: Settings,
  schedules: Clock,
};

/**
 * The navigation, the branch switcher and the account menu (spec section 10): a fixed sidebar from 1024px up, and the
 * same content in a drawer behind a slim top bar below that (seven links are too many for a bottom bar).
 */
export function AppShell({ practice, branch, branches, nav, user, children }: Props) {
  const [open, setOpen] = useState(false);
  const here = branches.find((b) => b.code === branch)?.name ?? branch;
  const sidebar = (onNavigate?: () => void) => <SidebarContent practice={practice} branch={branch} branches={branches} nav={nav} user={user} onNavigate={onNavigate} />;
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground print:hidden lg:flex">{sidebar()}</aside>

      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-card/95 px-3 backdrop-blur print:hidden lg:hidden">
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <MenuIcon aria-hidden />
          <span className="sr-only">Open the menu</span>
        </Button>
        <Link href="/" className="flex min-w-0 items-center gap-2 font-heading font-semibold">
          <BrandMark />
          <span className="truncate">{practice}</span>
        </Link>
        <span className="ml-auto max-w-[40%] truncate rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          <span className="sr-only">Branch: </span>
          {here}
        </span>
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="bg-sidebar text-sidebar-foreground [&_[data-slot=sheet-close]]:text-sidebar-foreground [&_[data-slot=sheet-close]:hover]:bg-sidebar-accent">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Pages, branch, and your account.</SheetDescription>
          {sidebar(() => setOpen(false))}
        </SheetContent>
      </Sheet>

      <main id="main" className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:ml-64 lg:px-8 lg:py-8">
        {children}
      </main>
    </div>
  );
}

function BrandMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg shadow-xs", className ?? "bg-primary text-primary-foreground")}>
      <LogoGlyph className="size-5" />
    </span>
  );
}

function SidebarContent({ practice, branch, branches, nav, user, onNavigate }: Omit<Props, "children"> & { onNavigate?: () => void }) {
  const pathname = usePathname();
  const here = branches.find((b) => b.code === branch)?.name ?? branch;
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-3">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5 rounded-lg px-2 py-2 font-heading text-base font-semibold text-sidebar-foreground outline-none focus-visible:ring-3 focus-visible:ring-white/80">
        <BrandMark className="bg-white text-primary" />
        <span className="truncate">{practice}</span>
      </Link>

      <div className="grid gap-1.5">
        <p className="px-2 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">Branch</p>
        {/* A menu of links rather than a select, so arrowing through the branches never leaves the page (WCAG 3.2.2). */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-11 w-full cursor-pointer items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent px-2.5 text-left text-sm font-medium text-sidebar-foreground outline-none transition-colors hover:bg-white/20 focus-visible:ring-3 focus-visible:ring-white/80 lg:h-10">
            <Building2 aria-hidden className="size-4 shrink-0 text-sidebar-muted" />
            <span className="min-w-0 flex-1 truncate">
              <span className="sr-only">Branch: </span>
              {here}
            </span>
            <ChevronsUpDownIcon aria-hidden className="size-4 shrink-0 text-sidebar-muted" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {branches.map((b) => (
              <DropdownMenuItem key={b.code} render={<Link href={withBranch(pathname, b.code)} onClick={onNavigate} />} aria-current={b.code === branch ? "page" : undefined}>
                {b.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto">
        <ul className="grid gap-0.5">
          {nav.map((item) => {
            const current = pathname === item.href || (item.href !== `/${branch}` && pathname.startsWith(`${item.href}/`));
            const Icon = ICONS[item.icon];
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "relative flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-white/80 lg:h-10",
                    current ? "bg-white/15 font-semibold text-sidebar-foreground" : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  )}
                >
                  {current && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-1 rounded-r-full bg-highlight" />}
                  <Icon aria-hidden className="size-[18px] shrink-0" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-sidebar-border pt-3">
        <UserMenu name={user.name} role={user.role} variant="sidebar" />
      </div>
    </div>
  );
}
