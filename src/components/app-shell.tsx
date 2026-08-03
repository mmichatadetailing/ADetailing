"use client";

import {
  BarChart3,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  ContactRound,
  FileStack,
  Gauge,
  Inbox,
  Menu,
  MessageSquareText,
  LogOut,
  Settings,
  Sparkles,
  UsersRound,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { GlobalAdd } from "./global-add";
import { GlobalSearch } from "./global-search";
import { useWorkspace } from "./workspace-provider";

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
      { href: "/clients", label: "Clients", icon: ContactRound },
      { href: "/documents", label: "Documents", icon: FileStack },
    ],
  },
  {
    label: "Gestion",
    items: [
      { href: "/finances", label: "Finances", icon: CircleDollarSign },
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
    <Link href="/dashboard" className="focus-ring group flex items-center gap-3 rounded-xl">
      <span className="grid size-10 rotate-[-3deg] place-items-center rounded-[14px] bg-gradient-to-br from-brand-500 via-orange-400 to-fuchsia-400 text-sm font-black tracking-tighter text-on-accent shadow-[0_10px_28px_rgba(249,115,79,.26)] transition-[transform,box-shadow] duration-300 ease-out group-hover:rotate-0 group-hover:scale-105 group-hover:shadow-[0_13px_32px_rgba(249,115,79,.32)]">AD</span>
      <span><span className="block text-sm font-extrabold tracking-tight">ADetailing</span><span className="block text-[10px] font-bold tracking-[.17em] text-zinc-600 uppercase">Pilotage</span></span>
    </Link>
  );
}

function Navigation({ close }: { close?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-2 px-3 text-[10px] font-bold tracking-[.18em] text-zinc-600 uppercase">{group.label}</p>
          <div className="grid gap-1">
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link key={item.href} href={item.href} onClick={close} aria-current={active ? "page" : undefined} className={cn("focus-ring row-interactive group flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-semibold", active ? "bg-gradient-to-r from-brand-50 to-orange-50 text-brand-600 shadow-sm" : "text-zinc-500 hover:text-zinc-200")}>
                  <item.icon className={cn("size-[17px] transition-[color,transform] duration-200", active ? "text-brand-500" : "text-zinc-600 group-hover:scale-110 group-hover:text-brand-500")} />
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
  const { mode, workspace, switchOrganization, signOut } = useWorkspace();
  const pathname = usePathname();
  const displayName = workspace ? `${workspace.firstName} ${workspace.lastName}`.trim() : "Melvyn";
  const initials = workspace ? `${workspace.firstName[0] ?? ""}${workspace.lastName[0] ?? ""}`.toUpperCase() : "MM";
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="glass fixed inset-y-0 left-0 z-40 hidden w-[250px] border-r border-white/[0.06] shadow-[8px_0_35px_rgba(78,64,120,.04)] lg:flex lg:flex-col">
        <div className="flex h-[76px] items-center border-b border-white/[0.06] px-6"><Brand /></div>
        <Navigation />
        <div className="relative m-3">
          {accountOpen && <div className="menu-popover absolute inset-x-0 bottom-[calc(100%+.5rem)] rounded-2xl border border-white/10 bg-white p-2 shadow-[0_20px_55px_rgba(47,40,72,.2)]">{workspace && workspace.organizations.length > 1 && <div className="mb-2 border-b border-zinc-100 pb-2"><p className="px-3 py-1 text-[9px] font-bold tracking-wider text-zinc-400 uppercase">Entreprise active</p>{workspace.organizations.map((organization) => <button key={organization.id} onClick={() => { setAccountOpen(false); void switchOrganization(organization.id).catch((error) => toast.error(error instanceof Error ? error.message : "Changement impossible.")); }} className={`focus-ring row-interactive flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold ${organization.id === workspace.organizationId ? "bg-brand-50 text-brand-700" : ""}`}><BriefcaseBusiness className="size-3.5" /><span className="truncate">{organization.name}</span>{organization.id === workspace.organizationId && <span className="ml-auto size-2 rounded-full bg-emerald-500" />}</button>)}</div>}<Link href="/compte" onClick={() => setAccountOpen(false)} className="focus-ring row-interactive flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold"><UserRound className="size-4 text-brand-500" /> Mon compte</Link>{mode === "supabase" && <button onClick={() => void signOut()} className="focus-ring flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-red-600 transition-colors hover:bg-red-50"><LogOut className="size-4" /> Se déconnecter</button>}</div>}
          <button onClick={() => setAccountOpen((value) => !value)} aria-expanded={accountOpen} className="focus-ring surface-interactive flex w-full items-center gap-3 rounded-2xl border border-brand-400/12 bg-gradient-to-br from-orange-50 via-ink-900 to-violet-50 p-3 text-left shadow-sm hover:border-brand-400/25">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-100 text-xs font-extrabold text-sky-600">{initials || "?"}</span><span className="min-w-0"><span className="block truncate text-xs font-bold">{displayName}</span><span className="block truncate text-[10px] text-zinc-600">{mode === "supabase" ? workspace?.organizationName : "Mode démonstration"}</span></span><ChevronDown className={`ml-auto size-4 text-zinc-600 transition ${accountOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-slate-900/25 backdrop-blur-sm" aria-label="Fermer le menu" onClick={() => setMenuOpen(false)} />
          <aside className="glass relative flex h-full w-[86%] max-w-[310px] flex-col border-r border-white/10 shadow-[20px_0_60px_rgba(47,40,72,.2)]">
            <div className="flex h-[70px] items-center justify-between border-b border-white/[0.06] px-5"><Brand /><Button variant="ghost" size="icon" onClick={() => setMenuOpen(false)}><X className="size-4" /></Button></div>
            <Navigation close={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}

      <div className="min-w-0 lg:col-start-2">
        <header className="glass sticky top-0 z-30 flex h-[70px] items-center gap-3 border-b border-white/[0.06] px-4 shadow-[0_8px_25px_rgba(78,64,120,.035)] sm:px-6 lg:h-[76px] lg:px-8">
          <Button variant="ghost" size="icon" className="shrink-0 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Ouvrir le menu"><Menu className="size-5" /></Button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            <Link href="/inbox" className="focus-ring icon-interactive relative grid size-10 place-items-center rounded-xl text-zinc-500" aria-label="Notifications"><Bell className="size-[18px] transition-transform duration-200" /></Link>
            <Link href="/inbox" className="focus-ring icon-interactive hidden size-10 place-items-center rounded-xl text-zinc-500 sm:grid" aria-label="Messages"><MessageSquareText className="size-[18px] transition-transform duration-200" /></Link>
            <GlobalAdd />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1560px] px-4 py-6 pb-24 sm:px-6 sm:py-8 lg:px-8 lg:pb-10">{children}</main>
      </div>

      <nav className="glass fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-white/[0.07] px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_35px_rgba(78,64,120,.06)] lg:hidden">
        {[
          { href: "/dashboard", label: "Accueil", icon: Gauge },
          { href: "/planning", label: "Planning", icon: CalendarDays },
          { href: "/clients", label: "Clients", icon: ContactRound },
          { href: "/prestations", label: "Prestations", icon: Sparkles },
          { href: "/finances", label: "Finances", icon: CircleDollarSign },
        ].map((item) => { const active = pathname === item.href || pathname.startsWith(`${item.href}/`); return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("focus-ring row-interactive group my-1 flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-xl text-[9px] font-bold", active ? "bg-brand-50 text-brand-600" : "text-zinc-500")}><item.icon className="size-[18px] transition-transform duration-200 group-hover:-translate-y-0.5" />{item.label}</Link>; })}
      </nav>
    </div>
  );
}
