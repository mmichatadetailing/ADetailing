import type { InterventionStatus, InvoiceStatus, LeadStage, PaymentStatus, QuoteStatus } from "./types";

export const leadStageLabels: Record<LeadStage, string> = {
  received: "Demande reçue",
  qualify: "À qualifier",
  quote_to_prepare: "Devis à préparer",
  quote_sent: "Devis envoyé",
  follow_up: "Relance à faire",
  won: "Accepté",
  lost: "Perdu",
};

export const interventionStatusLabels: Record<InterventionStatus, string> = {
  to_schedule: "À planifier",
  scheduled: "Planifiée",
  confirmed: "Confirmée",
  in_progress: "En cours",
  completed: "Terminée",
  cancelled: "Annulée",
};

export const quoteStatusLabels: Record<QuoteStatus, string> = {
  imported: "Importé",
  to_review: "À vérifier",
  sent: "Envoyé",
  accepted: "Accepté",
  refused: "Refusé",
  expired: "Expiré",
  cancelled: "Annulé",
};

export const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  imported: "Importée",
  to_review: "À vérifier",
  issued: "Émise",
  cancelled: "Annulée",
  credit_note: "Avoir",
};

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  unpaid: "Non payée",
  partial: "Partielle",
  paid: "Payée",
  overdue: "En retard",
};

