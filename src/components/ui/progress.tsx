import { cn } from "@/lib/utils";

export function Progress({ value, className }: { value: number; className?: string }) {
  const safe = Math.min(Math.max(value, 0), 100);
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-white/[0.065]", className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-brand-500 via-orange-400 to-amber-300 shadow-[0_0_12px_rgba(249,115,79,.25)] transition-[width] duration-500"
        style={{ width: `${safe}%` }}
      />
    </div>
  );
}
