"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { dateKey } from "@/lib/domain/periods";
import { cn } from "@/lib/utils";

const weekdays = ["L", "M", "M", "J", "V", "S", "D"];

function monthDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(date.getDate() + index);
    return date;
  });
}

export function PlanningDatePicker({ selectedDate, onSelect, onClose }: { selectedDate: Date; onSelect: (date: Date) => void; onClose: () => void }) {
  const [month, setMonth] = useState(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  const todayKey = dateKey(new Date());
  const selectedKey = dateKey(selectedDate);

  const moveMonth = (direction: -1 | 1) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1));
  };

  return (
    <Modal open onClose={onClose} title="Aller à une date" description="Choisissez directement le jour à afficher." className="sm:max-w-md">
      <div className="flex items-center justify-between gap-3">
        <Button size="icon" variant="ghost" aria-label="Mois précédent" onClick={() => moveMonth(-1)}><ChevronLeft className="size-4" /></Button>
        <p className="text-sm font-extrabold capitalize text-zinc-900">{new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(month)}</p>
        <Button size="icon" variant="ghost" aria-label="Mois suivant" onClick={() => moveMonth(1)}><ChevronRight className="size-4" /></Button>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center">
        {weekdays.map((weekday, index) => <span key={`${weekday}-${index}`} className="py-1 text-[10px] font-extrabold text-zinc-500">{weekday}</span>)}
        {monthDays(month).map((date) => {
          const key = dateKey(date);
          const outside = date.getMonth() !== month.getMonth();
          return (
            <button
              key={key}
              type="button"
              aria-label={new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date)}
              aria-pressed={key === selectedKey}
              onClick={() => { onSelect(date); onClose(); }}
              className={cn(
                "focus-ring grid aspect-square place-items-center rounded-xl text-xs font-bold transition hover:bg-brand-50 hover:text-brand-700",
                outside && "text-zinc-400",
                key === todayKey && "border border-brand-300 text-brand-700",
                key === selectedKey && "bg-gradient-to-br from-brand-500 to-orange-400 text-white shadow-sm hover:text-white",
              )}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      <Button variant="secondary" className="mt-4 w-full text-zinc-700" onClick={() => { onSelect(new Date()); onClose(); }}>Aujourd’hui</Button>
    </Modal>
  );
}
