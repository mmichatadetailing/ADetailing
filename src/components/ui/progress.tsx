import { cn } from "@/lib/utils";

export function Progress({ value, className }: { value: number; className?: string }) {
  const safe = Math.min(Math.max(value, 0), 100);
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-slate-200", className)}>
      <div
        className="ui-progress-fill h-full rounded-full transition-[width] duration-500"
        style={{ width: `${safe}%` }}
      />
    </div>
  );
}
