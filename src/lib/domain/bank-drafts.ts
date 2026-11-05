import type { BankTransaction } from "./banking";
import { z } from "zod";

export const bankDraftPayloadSchema = z.object({
  targetKey: z.string().max(200).optional(),
  title: z.string().trim().max(160), clientId: z.uuid().nullable().optional(),
  performedOn: z.iso.date().or(z.literal("")), completed: z.boolean(),
  revenue: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), durationMinutes: z.number().int().min(0).max(1440),
  workerId: z.uuid().nullable().optional(), notes: z.string().max(5000),
  expenseDate: z.iso.date().or(z.literal("")), supplier: z.string().trim().max(300), category: z.string().trim().max(120),
  family: z.enum(["fixed", "variable", "investment", "personal"]), vatRateBasisPoints: z.number().int().min(0).max(10000), vatRecoverable: z.boolean().default(false),
});
export type BankDraftPayload = z.infer<typeof bankDraftPayloadSchema>;
export interface BankDraft {
  id: string; side: "credit" | "debit"; status: "pending" | "dismissed" | "processed";
  payload: BankDraftPayload; transaction: BankTransaction; created_at: string; updated_at: string;
}
