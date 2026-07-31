export function Avatar({ label, color = "#f97316", size = "md" }: { label: string; color?: string; size?: "sm" | "md" }) {
  return <span className={`grid shrink-0 place-items-center rounded-xl text-[10px] font-bold text-white ${size === "sm" ? "size-7 rounded-lg" : "size-9"}`} style={{ backgroundColor: `${color}25`, color }}>{label}</span>;
}

