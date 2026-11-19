"use client";

import {
  BarChart3,
  BookOpen,
  Landmark,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  ContactRound,
  ReceiptText,
  Gauge,
  Inbox,
  Menu,
  MessageSquareText,
  Repeat2,
  LogOut,
  Settings,
  Sparkles,
  UsersRound,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { GlobalAdd } from "./global-add";
import { GlobalSearch } from "./global-search";
import { useWorkspace } from "./workspace-provider";
import { lockBodyScroll } from "@/lib/scroll-lock";
import { DataExport } from "./data-export";
import { BrandLogo } from "./brand-logo";
import { sectionTone } from "@/lib/navigation-colors";
import { ThemeToggle } from "./theme-toggle";

const groups = [
  {
    label: "Aujourd’hui",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: Gauge },
      { href: "/planning", label: "Planning", icon: CalendarDays },
      { href: "/inbox", label: "Boîte de réception", icon: Inbox },
    ],
  },
  {
    label: "Opérations",
    items: [
      { href: "/prestations", label: "Prestations", icon: Sparkles },
      { href: "/entretiens", label: "Entretiens mensuels", icon: Repeat2 },
      { href: "/clients", label: "Clients", icon: ContactRound },
      { href: "/factures", label: "Factures", icon: ReceiptText },
    ],
  },
  {
    label: "Gestion",
    items: [
      { href: "/finances", label: "Finances", icon: CircleDollarSign },
      { href: "/banque", label: "Banque & rapprochement", icon: Landmark },
      { href: "/pilotage", label: "Pilotage", icon: BarChart3 },
      { href: "/catalogue", label: "Catalogue", icon: BookOpen },
      { href: "/equipe", label: "Équipe", icon: UsersRound },
      { href: "/parametres", label: "Paramètres", icon: Settings },
      { href: "/compte", label: "Mon compte", icon: UserRound },
    ],
  },
];

function Brand() {
  return (
    <Link href="/dashboard" aria-label="ADetailing · Accueil" className="focus-ring flex items-center gap-4 rounded-lg">
      <BrandLogo priority className="w-[108px]" />
      <span className="border-l border-contrast/15 py-2 pl-4 text-[9px] font-medium tracking-[.14em] text-zinc-500 uppercase">Espace<br /><span className="font-semibold text-zinc-200">Pilotage</span></span>
    </Link>
  );
}

function Navigation({ close }: { close?: () => void }) {
  const pathname = usePathname();
  const { mode, workspace } = useWorkspace();
  const canViewInvoices = mode === "demo" || Boolean(workspace?.canManageBusiness);
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-6" aria-label="Menu principal">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-2 px-3 text-[9px] font-semibold tracking-[.17em] text-zinc-600 uppercase">{group.label}</p>
          <div className="grid gap-1">
            {group.items.filter((item) => item.href !== "/factures" || canViewInvoices).map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link key={item.href} href={item.href} onClick={close} aria-current={active ? "page" : undefined} data-tone={sectionTone(item.href)} className="app-nav-link focus-ring row-interactive group flex min-h-10 items-center gap-3 rounded-full px-3 text-[12px] font-medium text-zinc-500">
                  <span className="app-nav-icon"><item.icon className="size-[16px]" /></span>
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const { mode, workspace, switchOrganization, signOut } = useWorkspace();
  const pathname = usePathname();
  const displayName = workspace ? `${workspace.firstName} ${workspace.lastName}`.trim() : "Melvyn";
  const initials = workspace ? `${workspace.firstName[0] ?? ""}${workspace.lastName[0] ?? ""}`.toUpperCase() : "MM";
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const release = lockBodyScroll();
    const controls = () => Array.from(mobileMenuRef.current?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), select:not(:disabled)") ?? []);
    controls()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMenuOpen(false); }
      if (event.key !== "Tab") return;
      const first = controls()[0];
      const last = controls().at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handler);
    return () => { release(); document.removeEventListener("keydown", handler); previous?.focus({ preventScroll: true }); };
  }, [menuOpen]);
  useEffect(() => {
    if (!accountOpen) return;
    const dismiss = (event: PointerEvent) => { if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setAccountOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [accountOpen]);
  return (
    <div id="app-shell" data-tone={sectionTone(pathname)} className="min-h-screen lg:grid lg:grid-cols-[250px_minmax(0,1fr)]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:rounded-xl focus:bg-surface focus:p-3 focus:shadow-lg">Aller au contenu</a>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[250px] border-r border-contrast/[0.08] bg-surface lg:flex lg:flex-col">
        <div className="flex h-[76px] items-center border-b border-white/[0.06] px-6"><Brand /></div>
        <Navigation />
        <div ref={accountRef} className="relative m-3">
          {accountOpen && <div className="menu-popover absolute inset-x-0 bottom-[calc(100%+.5rem)] rounded-2xl border border-white/10 bg-surface p-2 shadow-[0_16px_48px_rgba(22,25,20,.14)]">{workspace && workspace.organizations.length > 1 && <div className="mb-2 border-b border-line pb-2"><p className="px-3 py-1 text-[9px] font-bold tracking-wider text-zinc-400 uppercase">Entreprise active</p>{workspace.organizations.map((organization) => <button key={organization.id} onClick={() => { setAccountOpen(false); void switchOrganization(organization.id).catch((error) => toast.error(error instanceof Error ? error.message : "Changement impossible.")); }} className={`focus-ring row-interactive flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold ${organization.id === workspace.organizationId ? "bg-brand-50 text-brand-700" : ""}`}><BriefcaseBusiness className="size-3.5" /><span className="truncate">{organization.name}</span>{organization.id === workspace.organizationId && <span className="ml-auto size-2 rounded-full bg-emerald-500" />}</button>)}</div>}<Link href="/compte" onClick={() => setAccountOpen(false)} className="focus-ring row-interactive flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold"><UserRound className="size-4 text-brand-500" /> Mon compte</Link>{mode === "supabase" && <button onClick={() => void signOut()} className="focus-ring flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-red-600 transition-colors hover:bg-red-50"><LogOut className="size-4" /> Se déconnecter</button>}</div>}
          <button onClick={() => setAccountOpen((value) => !value)} aria-expanded={accountOpen} className="focus-ring surface-interactive flex w-full items-center gap-3 rounded-2xl border border-contrast/10 bg-brand-50/60 p-3 text-left shadow-sm hover:border-brand-400/25">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface text-xs font-semibold text-zinc-200">{initials || "?"}</span><span className="min-w-0"><span className="block truncate text-xs font-bold">{displayName}</span><span className="block truncate text-[10px] text-zinc-600">{mode === "supabase" ? workspace?.organizationName : "Mode démonstration"}</span></span><ChevronDown className={`ml-auto size-4 text-zinc-600 transition ${accountOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-black/30 backdrop-blur-sm" aria-label="Fermer le menu" onClick={() => setMenuOpen(false)} />
          <aside ref={mobileMenuRef} role="dialog" aria-modal="true" aria-label="Navigation" className="glass relative flex h-full w-[86%] max-w-[310px] flex-col border-r border-white/10 shadow-[20px_0_60px_rgba(22,25,20,.16)]">
            <div className="flex h-[70px] items-center justify-between border-b border-white/[0.06] px-5"><Brand /><Button variant="ghost" size="icon" aria-label="Fermer la navigation" onClick={() => setMenuOpen(false)}><X className="size-4" /></Button></div>
            <Navigation close={() => setMenuOpen(false)} />
            {mode === "supabase" && <div className="border-t border-line p-3"><p className="truncate px-3 py-2 text-xs font-semibold">{displayName}</p>{workspace && workspace.organizations.length > 1 && <label className="mb-2 grid gap-1 px-3 text-xs text-zinc-600">Entreprise active<select className="focus-ring min-h-10 w-full rounded-xl border border-line bg-surface px-2" value={workspace.organizationId} onChange={(event) => { setMenuOpen(false); void switchOrganization(event.target.value).catch((error) => toast.error(error instanceof Error ? error.message : "Changement impossible.")); }}>{workspace.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>}<Button variant="ghost" onClick={() => void signOut()}><LogOut className="size-4" /> Se déconnecter</Button></div>}
          </aside>
        </div>
      )}

      <div className="min-w-0 lg:col-start-2">
        <header className="glass sticky top-0 z-30 flex h-[var(--app-header-height)] items-center gap-3 border-b border-white/[0.06] px-4  sm:px-6 lg:px-8">
          <Button variant="ghost" size="icon" className="shrink-0 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Ouvrir le menu"><Menu className="size-5" /></Button>
          <GlobalSearch />
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <DataExport compact />
            <Link href="/inbox" className="focus-ring icon-interactive grid size-10 place-items-center rounded-xl text-zinc-500" aria-label="Boîte de réception"><MessageSquareText className="size-[18px] transition-transform duration-200" /></Link>
            <GlobalAdd />
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1560px] scroll-mt-24 px-4 py-6 pb-24 outline-none sm:px-6 sm:py-8 lg:px-8 lg:pb-10">{children}</main>
      </div>

      <nav className="glass fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-white/[0.07] px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_15px_rgba(22,25,20,.04)] lg:hidden">
        {[
          { href: "/dashboard", label: "Accueil", icon: Gauge },
          { href: "/planning", label: "Planning", icon: CalendarDays },
          { href: "/clients", label: "Clients", icon: ContactRound },
          { href: "/prestations", label: "Prestations", icon: Sparkles },
          { href: "/finances", label: "Finances", icon: CircleDollarSign },
        ].map((item) => { const active = pathname === item.href || pathname.startsWith(`${item.href}/`); return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} data-tone={sectionTone(item.href)} className="mobile-nav-link focus-ring row-interactive group my-1 flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-xl text-[9px] font-bold text-zinc-500"><item.icon className="size-[18px] transition-transform duration-200 group-hover:-translate-y-0.5" />{item.label}</Link>; })}
      </nav>
    </div>
  );
}
