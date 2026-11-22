"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { getCompanyStatsPeriod, getCompanyStatsPeriodOptions, reportKey, type CompanyStatsPeriod } from "@/lib/domain/periods";

export function useReportPeriod(fallback: "month" | "year") {
  const params = useSearchParams();
  const key = reportKey(params.get("periode"), fallback);
  return useMemo(() => getCompanyStatsPeriod(key), [key]);
}

export function ReportPeriodPicker({ period }: { period: CompanyStatsPeriod }) {
  return <label className="grid gap-1 text-left">
    <span className="text-[10px] font-bold tracking-[.12em] text-zinc-500 uppercase">Période analysée</span>
    <select value={period.key} onChange={event => {
      const url = new URL(window.location.href);
      url.searchParams.set("periode", event.target.value.split(":")[1]!);
      window.history.replaceState(null, "", url);
    }} className="focus-ring min-h-11 min-w-52 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-zinc-800 shadow-sm">
      {getCompanyStatsPeriodOptions().map(group => <optgroup key={group.year} label={String(group.year)}>
        {group.options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
      </optgroup>)}
    </select>
  </label>;
}
