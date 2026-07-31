import type { ReactNode } from "react";
import { Badge } from "./ui/badge";

export function statusVariant(status: string): "green" | "red" | "yellow" | "orange" | "blue" | "neutral" {
  if (["paid", "completed", "accepted", "won"].includes(status)) return "green";
  if (["overdue", "cancelled", "lost", "refused", "expired"].includes(status)) return "red";
  if (["unpaid", "partial", "to_review"].includes(status)) return "yellow";
  if (["follow_up", "in_progress"].includes(status)) return "orange";
  if (["confirmed", "scheduled", "sent", "issued"].includes(status)) return "blue";
  return "neutral";
}

export function StatusBadge({ status, children }: { status: string; children: ReactNode }) {
  return <Badge variant={statusVariant(status)}>{children}</Badge>;
}
