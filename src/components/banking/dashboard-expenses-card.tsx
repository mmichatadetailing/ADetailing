"use client";

import Link from "next/link";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { dashboardExpenses, type PeriodExpenseLine } from "@/lib/domain/dashboard-expenses";
import { expenseFamilyLabels } from "@/lib/domain/finance-presentation";
import { expenseRegisterHref } from "@/lib/domain/journal-links";
import { financialDateKey } from "@/lib/domain/periods";
import type { Expense } from "@/lib/domain/types";
import { formatDate, formatMoney } from "@/lib/utils";

const sections = { paid: "Réglées", outstanding: "Reste à payer" } as const;
type Section = keyof typeof sections;

function lineDescription(line: PeriodExpenseLine, today: string) {
  const date = formatDate(line.day, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" });
  if (!line.source) return (line.day < today ? "Échue le " : "Échéance le ") + date;
  const method = line.source === "cash" ? "Espèces" : line.grouped ? "Virement groupé" :
    line.source === "linked" ? "Rapprochée de Qonto" : line.expense.paymentMethod || "Règlement enregistré";
  const due = line.month === line.day.slice(0, 7) ? "" : " · échéance de " + formatDate(line.month + "-01", { month: "long", year: "numeric", timeZone: "Europe/Paris" });
  return "Réglée le " + date + " · " + method + due;
}

export function DashboardExpensesCard({ expenses, months, label }: { expenses: Expense[]; months: string[]; label: string }) {
  const today = financialDateKey(new Date().toISOString());
  const summary = useMemo(() => dashboardExpenses(expenses, months, today), [expenses, months, today]);
  const [detail, setDetail] = useState<Section | null>(null);
  const selected = detail ?? "paid";
  const lines = summary[selected].lines;

  return <>
    <button type="button" aria-haspopup="dialog" data-tone="blue"
      onClick={() => setDetail(!summary.paid.lines.length && summary.outstanding.lines.length ? "outstanding" : "paid")}
      className="finance-metric focus-ring group flex flex-col gap-2 text-left transition hover:shadow-md motion-safe:hover:-translate-y-0.5 xl:col-span-3">
      <span className="flex items-center gap-2 text-sm font-semibold text-[var(--tone-color)]"><ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />Charges de la période</span>
      <span className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
        <span>Réglées</span><strong className="text-xl tabular-nums">{formatMoney(summary.paid.total)}</strong>
      </span>
      {summary.paid.cash > 0 && <span className="-mt-2 text-right text-xs text-zinc-500">dont {formatMoney(summary.paid.cash)} en espèces</span>}
      <span className="flex flex-wrap items-baseline justify-between gap-x-2 border-t border-line pt-1 text-sm">
        <span>Reste à payer</span><strong className="text-xl tabular-nums">{formatMoney(summary.outstanding.total)}</strong>
      </span>
      <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-semibold text-[var(--tone-color)] group-hover:underline">Voir le détail<ChevronRight aria-hidden="true" className="size-3.5" /></span>
    </button>
    {detail !== null && <Modal open onClose={() => setDetail(null)} title="Détail des charges" description={label + " · Toutes les dépenses TTC du registre interne."} className="sm:max-w-2xl">
      <div className="space-y-4">
        <div role="group" aria-label="Afficher les dépenses" className="finance-nav">
          {(["paid", "outstanding"] as const).map((section) => <button key={section} type="button" data-tone={section === "paid" ? "emerald" : "amber"}
            aria-pressed={section === selected} onClick={() => setDetail(section)} className="focus-ring">
            {sections[section]} · {formatMoney(summary[section].total)}
          </button>)}
        </div>
        <p className="text-sm text-zinc-600">{selected === "paid"
          ? "Règlements effectués pendant la période, en espèces ou par tout autre moyen de paiement."
          : "Échéances de la période sans règlement confirmé à ce jour. Un prélèvement prévu ne vaut pas paiement."}</p>
        {lines.length ? <>
          <p className="text-xs font-semibold text-zinc-500">{lines.length} {lines.length === 1 ? "dépense" : "dépenses"}</p>
          <ul aria-label={sections[selected]} className="divide-y divide-line rounded-xl border border-line">
            {lines.map((line) => <li key={line.key}>
              <Link prefetch={false} href={expenseRegisterHref(line.expense.id, line.month)} className="focus-ring flex items-center justify-between gap-3 rounded-xl p-3 hover:bg-[var(--surface-raised)]">
                <span className="min-w-0 space-y-1">
                  <span className="block break-words text-sm font-semibold">{line.expense.description || line.expense.supplier || line.expense.category || "Dépense"}</span>
                  <span className="block break-words text-xs text-zinc-600">{[expenseFamilyLabels[line.expense.family], line.expense.description && line.expense.supplier].filter(Boolean).join(" · ")}</span>
                  <span className="block text-xs text-zinc-600">{lineDescription(line, today)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-sm font-bold tabular-nums">{formatMoney(line.amount)}<ChevronRight aria-hidden="true" className="size-3.5" /></span>
              </Link>
            </li>)}
          </ul>
        </> : <p className="rounded-xl border border-dashed border-line p-4 text-sm">{selected === "paid" ? "Aucune dépense réglée sur cette période." : "Rien ne reste à payer sur cette période."}</p>}
      </div>
    </Modal>}
  </>;
}
