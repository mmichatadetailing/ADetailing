import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variants = {
  neutral: "border-white/8 bg-white/[0.045] text-zinc-300",
  orange: "border-orange-400/20 bg-orange-100/75 text-orange-300",
  green: "border-emerald-400/20 bg-emerald-50 text-emerald-300",
  blue: "border-sky-400/20 bg-sky-50 text-sky-300",
  red: "border-red-400/20 bg-red-50 text-red-300",
  yellow: "border-amber-400/20 bg-amber-50 text-amber-200",
};

export function Badge({
  className,
  variant = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof variants }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap shadow-[0_1px_2px_rgba(41,50,71,.03)] transition-[border-color,background-color,box-shadow] duration-200",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
