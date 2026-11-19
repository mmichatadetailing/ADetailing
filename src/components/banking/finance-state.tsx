import type { FinanceState as State } from "@/lib/domain/finance-presentation";

export function FinanceState({ label, tone }: State) {
  return <span data-tone={tone} className="finance-state">{label}</span>;
}
