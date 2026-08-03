export type UUID = string;
export type ISODate = string;
export type Money = number;

export type MemberRole = "admin" | "partner" | "employee";
export type LeadStage =
  | "received"
  | "qualify"
  | "quote_to_prepare"
  | "quote_sent"
  | "follow_up"
  | "won"
  | "lost";
export type InterventionStatus =
  | "to_schedule"
  | "scheduled"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled";
export type QuoteStatus =
  | "imported"
  | "to_review"
  | "sent"
  | "accepted"
  | "refused"
  | "expired"
  | "cancelled";
export type InvoiceStatus = "imported" | "to_review" | "issued" | "cancelled" | "credit_note";
export type PaymentStatus = "unpaid" | "partial" | "paid" | "overdue";
export type ServiceKind = "formula" | "option" | "subscription" | "pack";

export interface BaseEntity {
  id: UUID;
  organizationId: UUID;
  locationId: UUID;
  createdAt: ISODate;
  updatedAt: ISODate;
  legacyId?: string;
  legacyRow?: number;
}

export interface TeamMember extends BaseEntity {
  profileId?: UUID;
  firstName: string;
  lastName: string;
  initials: string;
  email: string;
  phone: string;
  role: MemberRole;
  color: string;
  active: boolean;
  weeklyCapacityMinutes: number;
}

export interface Client extends BaseEntity {
  kind: "individual" | "business";
  company?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  postalCode: string;
  city: string;
  siret?: string;
  vatNumber?: string;
  source: string;
  ownerId: UUID;
  notes: string;
  nextAction?: string;
  archivedAt?: ISODate;
}

export interface Vehicle extends BaseEntity {
  clientId: UUID;
  make: string;
  model: string;
  registration: string;
  format: string;
  year?: number;
  color?: string;
  mileage?: number;
  initialCondition?: string;
  notes?: string;
}

export interface Lead extends BaseEntity {
  clientId?: UUID;
  prospectName: string;
  company?: string;
  phone: string;
  email: string;
  vehicleLabel: string;
  serviceLabel: string;
  estimatedAmount: Money;
  source: string;
  stage: LeadStage;
  ownerId: UUID;
  requestedAt: ISODate;
  nextAction: string;
  nextActionAt?: ISODate;
  lostReason?: string;
  notes?: string;
}

export interface ServicePrice {
  vehicleFormat: string;
  amount: Money;
}

export interface Service extends BaseEntity {
  kind: ServiceKind;
  category: string;
  name: string;
  clientDescription: string;
  internalDescription: string;
  prices: ServicePrice[];
  targetDurationMinutes: number;
  targetProductCost: Money;
  targetTravelCost: Money;
  targetHourlyMargin: Money;
  vatRateBasisPoints: number;
  active: boolean;
  archivedAt?: ISODate;
  displayOrder: number;
  aliases: string[];
  recommendedWorkers: number;
  photosRequired: boolean;
}

export interface DocumentLine {
  id: UUID;
  designation: string;
  description?: string;
  quantity: number;
  unitPrice: Money;
  discount: Money;
  netAmount: Money;
  vatRateBasisPoints: number;
  serviceId?: UUID;
  vehicleId?: UUID;
}

export interface Quote extends BaseEntity {
  number: string;
  clientId: UUID;
  status: QuoteStatus;
  issuedAt: ISODate;
  validUntil?: ISODate;
  totalExcludingTax: Money;
  totalTax: Money;
  totalIncludingTax: Money;
  lines: DocumentLine[];
  paymentTerms?: string;
  sourceFileName?: string;
  acceptedAt?: ISODate;
  nextFollowUpAt?: ISODate;
}

export interface Invoice extends BaseEntity {
  number: string;
  clientId: UUID;
  quoteId?: UUID;
  status: InvoiceStatus;
  paymentStatus: PaymentStatus;
  issuedAt: ISODate;
  dueAt?: ISODate;
  totalExcludingTax: Money;
  totalTax: Money;
  totalIncludingTax: Money;
  lines: DocumentLine[];
  expectedPaymentMethod?: string;
  sourceFileName?: string;
}

export interface Payment extends BaseEntity {
  invoiceId?: UUID;
  interventionId?: UUID;
  amount: Money;
  paidAt: ISODate;
  method: string;
  reference?: string;
  notes?: string;
}

export interface InterventionItem {
  id: UUID;
  serviceId?: UUID;
  label: string;
  revenueAllocated: Money;
  quantity: number;
}

export interface InterventionWorker {
  memberId: UUID;
  plannedMinutes: number;
  actualMinutes?: number;
}

export interface Intervention extends BaseEntity {
  clientId: UUID;
  vehicleId?: UUID;
  vehicleFormat?: string;
  quoteId?: UUID;
  invoiceId?: UUID;
  status: InterventionStatus;
  title: string;
  startAt?: ISODate;
  endAt?: ISODate;
  plannedDurationMinutes: number;
  actualDurationMinutes?: number;
  preparationMinutes?: number;
  cleanupMinutes?: number;
  workers: InterventionWorker[];
  items: InterventionItem[];
  productCost: Money;
  travelCost: Money;
  otherDirectCosts: Money;
  address: string;
  checklistDone: number;
  checklistTotal: number;
  depositAmount: Money;
  notes?: string;
}

export interface Expense extends BaseEntity {
  date: ISODate;
  family: "fixed" | "variable" | "investment" | "personal";
  category: string;
  supplier: string;
  description: string;
  amountIncludingTax: Money;
  amountExcludingTax: Money;
  vatAmount: Money;
  vatRecoverable: boolean;
  recurrence: "monthly" | "annual" | "one_off";
  allocatedMonth: string;
  paid: boolean;
  paidAt?: ISODate;
  paymentMethod?: string;
}

export interface Asset extends BaseEntity {
  name: string;
  category: string;
  status: "to_buy" | "ordered" | "in_service" | "to_replace" | "sold";
  priority: "low" | "medium" | "high";
  priceIncludingTax: Money;
  expectedTimeGainMinutes: number;
  expectedMonthlyRevenue: Money;
  supplier?: string;
  commissionedAt?: ISODate;
}

export interface MonthlyObjective extends BaseEntity {
  month: string;
  revenueTarget: Money;
  interventionTarget: number;
  averageBasketTarget: Money;
  hourlyMarginTarget: Money;
  reviewTarget: number;
  note?: string;
}

export interface Review extends BaseEntity {
  clientId: UUID;
  interventionId: UUID;
  requestedAt?: ISODate;
  receivedAt?: ISODate;
  rating?: number;
  comment?: string;
  url?: string;
  contentAuthorized: boolean;
}

export interface Activity extends BaseEntity {
  kind:
    | "lead_created"
    | "quote_imported"
    | "invoice_imported"
    | "payment_added"
    | "intervention_moved"
    | "comment_added"
    | "objective_updated";
  title: string;
  description: string;
  actorId: UUID;
  occurredAt: ISODate;
  entityType?: string;
  entityId?: UUID;
}

export interface Message extends BaseEntity {
  channel: "general" | "entity";
  entityType?: "client" | "intervention" | "quote" | "invoice" | "expense" | "asset";
  entityId?: UUID;
  authorId: UUID;
  body: string;
  sentAt: ISODate;
  editedAt?: ISODate;
  deletedAt?: ISODate;
  readBy: UUID[];
}

export interface AppSettings {
  organizationName: string;
  locationName: string;
  locationCity: string;
  pilotYear: number;
  initialCash: Money;
  standardVatBasisPoints: number;
  dailyAvailableMinutes: number;
  hourlyMarginTarget: Money;
  averageBasketTarget: Money;
  conversionTargetBasisPoints: number;
  monthlyReviewTarget: number;
  googleRatingTarget: number;
  reviewRateTargetBasisPoints: number;
  cashSafetyBuffer: Money;
  leadSources: string[];
  lostReasons: string[];
  vehicleFormats: string[];
}

export interface AppData {
  team: TeamMember[];
  clients: Client[];
  vehicles: Vehicle[];
  leads: Lead[];
  services: Service[];
  quotes: Quote[];
  invoices: Invoice[];
  payments: Payment[];
  interventions: Intervention[];
  expenses: Expense[];
  assets: Asset[];
  objectives: MonthlyObjective[];
  reviews: Review[];
  activities: Activity[];
  messages: Message[];
  settings: AppSettings;
}
