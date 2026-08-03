import type { SupabaseClient, User } from "@supabase/supabase-js";
import type {
  Activity,
  AppData,
  AppSettings,
  Asset,
  Client,
  DocumentLine,
  Expense,
  Intervention,
  Invoice,
  Lead,
  MemberRole,
  Message,
  MonthlyObjective,
  Payment,
  Quote,
  Review,
  Service,
  TeamMember,
  Vehicle,
} from "@/lib/domain/types";

type Row = Record<string, unknown>;

export interface WorkspaceIdentity {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  locationId: string;
  locationName: string;
  locationCity: string;
  role: MemberRole;
  organizations: Array<{ id: string; name: string; role: MemberRole }>;
  canManageTeam: boolean;
}

export interface TeamInvitation {
  id: string;
  memberId?: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Exclude<MemberRole, "admin">;
  weeklyCapacityMinutes: number;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface BootstrapPayload {
  workspace: WorkspaceIdentity;
  data: AppData;
  invitations: TeamInvitation[];
}

const isRow = (value: unknown): value is Row => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter(isRow) : [];
const one = (value: unknown): Row => isRow(value) ? value : (Array.isArray(value) && isRow(value[0]) ? value[0] : {});
const text = (row: Row, key: string, fallback = "") => typeof row[key] === "string" ? row[key] as string : fallback;
const optionalText = (row: Row, key: string) => text(row, key) || undefined;
const number = (row: Row, key: string, fallback = 0) => {
  const value = row[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};
const bool = (row: Row, key: string, fallback = false) => typeof row[key] === "boolean" ? row[key] as boolean : fallback;
const nullableNumber = (row: Row, key: string) => row[key] == null ? undefined : number(row, key);
const iso = (value: string) => value ? new Date(value).toISOString() : new Date().toISOString();

function settingNumber(settings: Map<string, unknown>, key: string, fallback: number) {
  const value = settings.get(key);
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function settingStrings(settings: Map<string, unknown>, key: string, fallback: string[]) {
  const value = settings.get(key);
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;
}

function documentLines(value: unknown): DocumentLine[] {
  return rows(value).map((row) => ({
    id: text(row, "id"),
    designation: text(row, "designation"),
    description: optionalText(row, "description"),
    quantity: number(row, "quantity", 1),
    unitPrice: number(row, "unit_price_cents"),
    discount: number(row, "discount_cents"),
    netAmount: number(row, "net_amount_cents"),
    vatRateBasisPoints: number(row, "vat_rate_basis_points"),
    serviceId: optionalText(row, "service_id"),
    vehicleId: optionalText(row, "vehicle_id"),
  }));
}

const activityKinds = new Set<Activity["kind"]>([
  "lead_created", "quote_imported", "invoice_imported", "payment_added", "intervention_moved", "comment_added", "objective_updated",
]);

export async function loadSupabaseAppData(supabase: SupabaseClient, user: User): Promise<BootstrapPayload> {
  const profileResult = await supabase.from("profiles").select("id,first_name,last_name,email,current_organization_id").eq("id", user.id).single();
  if (profileResult.error) throw profileResult.error;
  const currentProfile = one(profileResult.data);

  const membershipResult = await supabase
    .from("organization_members")
    .select("organization_id,location_id,role,organizations(id,name,slug),locations(id,name,city)")
    .eq("profile_id", user.id)
    .eq("active", true)
    .order("created_at");
  if (membershipResult.error) throw membershipResult.error;
  const memberships = rows(membershipResult.data);
  if (memberships.length === 0) throw new Error("Aucun espace de travail n’est associé à ce compte.");

  const preferredOrganizationId = text(currentProfile, "current_organization_id");
  const membership = memberships.find((item) => text(item, "organization_id") === preferredOrganizationId) ?? memberships[0] ?? {};
  const organization = one(membership.organizations);
  const location = one(membership.locations);
  const organizationId = text(membership, "organization_id");
  const locationId = text(membership, "location_id");

  const results = await Promise.all([
    supabase.from("organization_members").select("id,organization_id,profile_id,provisional_first_name,provisional_last_name,provisional_email,role,location_id,active,weekly_capacity_minutes,color,created_at,updated_at,profiles(id,first_name,last_name,email,phone,created_at,updated_at)").eq("organization_id", organizationId),
    supabase.from("lead_sources").select("id,name,display_order").eq("organization_id", organizationId).eq("active", true).order("display_order"),
    supabase.from("vehicle_formats").select("id,name,display_order").eq("organization_id", organizationId).eq("active", true).order("display_order"),
    supabase.from("clients").select("*,lead_sources(name)").eq("organization_id", organizationId).is("archived_at", null).order("created_at", { ascending: false }),
    supabase.from("vehicles").select("*,vehicle_formats(name)").eq("organization_id", organizationId).is("archived_at", null).order("created_at", { ascending: false }),
    supabase.from("leads").select("*,lead_sources(name)").eq("organization_id", organizationId).is("archived_at", null).order("requested_at", { ascending: false }),
    supabase.from("services").select("*,service_categories(name),service_prices(amount_cents,maximum_amount_cents,pricing_label,minimum_vehicle_count,maximum_vehicle_count,vehicle_formats(name)),service_aliases(alias)").eq("organization_id", organizationId).is("archived_at", null).order("display_order"),
    supabase.from("quotes").select("*,quote_items(*)").eq("organization_id", organizationId).is("archived_at", null).order("issued_at", { ascending: false }),
    supabase.from("invoices").select("*,invoice_items(*)").eq("organization_id", organizationId).is("archived_at", null).order("issued_at", { ascending: false }),
    supabase.from("payments").select("*").eq("organization_id", organizationId).order("paid_at", { ascending: false }),
    supabase.from("interventions").select("*,intervention_items(*),intervention_workers(*),intervention_checklist_items(*)").eq("organization_id", organizationId).is("archived_at", null).order("start_at"),
    supabase.from("expenses").select("*").eq("organization_id", organizationId).is("archived_at", null).order("expense_date", { ascending: false }),
    supabase.from("assets").select("*").eq("organization_id", organizationId).is("archived_at", null).order("created_at", { ascending: false }),
    supabase.from("monthly_objectives").select("*").eq("organization_id", organizationId).order("month"),
    supabase.from("reviews").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("activity_logs").select("*").eq("organization_id", organizationId).order("occurred_at", { ascending: false }).limit(100),
    supabase.from("messages").select("*,conversations(kind,entity_type,entity_id,conversation_members(profile_id,last_read_at))").eq("organization_id", organizationId).is("deleted_at", null).order("created_at"),
    supabase.from("app_settings").select("key,value").eq("organization_id", organizationId),
    supabase.from("organization_invitations").select("id,pending_member_id,invited_first_name,invited_last_name,email,role,weekly_capacity_minutes,expires_at,accepted_at,revoked_at,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
  ]);
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) throw firstError;
  const [memberRows = [], sourceRows = [], formatRows = [], clientRows = [], vehicleRows = [], leadRows = [], serviceRows = [], quoteRows = [], invoiceRows = [], paymentRows = [], interventionRows = [], expenseRows = [], assetRows = [], objectiveRows = [], reviewRows = [], activityRows = [], messageRows = [], settingRows = [], invitationRows = []] = results.map((result) => rows(result.data));

  const base = (row: Row) => ({
    id: text(row, "id"),
    organizationId: text(row, "organization_id", organizationId),
    locationId: text(row, "location_id", locationId),
    createdAt: iso(text(row, "created_at")),
    updatedAt: iso(text(row, "updated_at", text(row, "created_at"))),
    legacyId: optionalText(row, "legacy_id"),
    legacyRow: nullableNumber(row, "legacy_row"),
  });

  const team: TeamMember[] = memberRows.map((row) => {
    const profile = one(row.profiles);
    const profileId = optionalText(row, "profile_id");
    const firstName = profileId ? text(profile, "first_name", text(row, "provisional_first_name", "Membre")) : text(row, "provisional_first_name", "Membre");
    const lastName = profileId ? text(profile, "last_name", text(row, "provisional_last_name")) : text(row, "provisional_last_name");
    return {
      ...base({ ...row, id: profileId || text(row, "id"), created_at: profile.created_at ?? row.created_at, updated_at: profile.updated_at ?? row.updated_at }),
      profileId,
      firstName,
      lastName,
      initials: `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase(),
      email: profileId ? text(profile, "email", text(row, "provisional_email")) : text(row, "provisional_email"),
      phone: text(profile, "phone"),
      role: text(row, "role", "employee") as MemberRole,
      color: text(row, "color", "#f9734f"),
      active: bool(row, "active", true),
      weeklyCapacityMinutes: number(row, "weekly_capacity_minutes", 2100),
    };
  });
  const clients: Client[] = clientRows.map((row) => ({
    ...base(row), kind: text(row, "kind", "individual") as Client["kind"], company: optionalText(row, "company"), firstName: text(row, "first_name"), lastName: text(row, "last_name"),
    email: text(row, "email"), phone: text(row, "phone"), address: text(row, "address"), postalCode: text(row, "postal_code"), city: text(row, "city"), siret: optionalText(row, "siret"), vatNumber: optionalText(row, "vat_number"),
    source: text(one(row.lead_sources), "name", "Non renseignée"), ownerId: text(row, "owner_id", user.id), notes: text(row, "notes"), nextAction: optionalText(row, "next_action"), archivedAt: optionalText(row, "archived_at"),
  }));
  const vehicles: Vehicle[] = vehicleRows.map((row) => ({
    ...base(row), clientId: text(row, "client_id"), make: text(row, "make"), model: text(row, "model"), registration: text(row, "registration"), format: text(one(row.vehicle_formats), "name", "Autre"),
    year: nullableNumber(row, "year"), color: optionalText(row, "color"), mileage: nullableNumber(row, "mileage"), initialCondition: optionalText(row, "initial_condition"), notes: optionalText(row, "notes"),
  }));
  const leads: Lead[] = leadRows.map((row) => ({
    ...base(row), clientId: optionalText(row, "client_id"), prospectName: text(row, "prospect_name"), company: optionalText(row, "company"), phone: text(row, "phone"), email: text(row, "email"),
    vehicleLabel: text(row, "vehicle_label"), serviceLabel: text(row, "service_label"), estimatedAmount: number(row, "estimated_amount_cents"), source: text(one(row.lead_sources), "name", "Non renseignée"),
    stage: text(row, "stage", "received") as Lead["stage"], ownerId: text(row, "owner_id", user.id), requestedAt: iso(text(row, "requested_at")), nextAction: text(row, "next_action", "Qualifier la demande"),
    nextActionAt: optionalText(row, "next_action_at"), lostReason: optionalText(row, "lost_reason"), notes: optionalText(row, "notes"),
  }));
  const services: Service[] = serviceRows.map((row) => ({
    ...base(row), kind: text(row, "kind", "formula") as Service["kind"], pricingMode: text(row, "pricing_mode", "vehicle_format") as Service["pricingMode"], category: text(one(row.service_categories), "name", "Sans catégorie"), name: text(row, "name"),
    clientDescription: text(row, "client_description"), internalDescription: text(row, "internal_description"), prices: rows(row.service_prices).map((price) => {
      const vehicleFormat = optionalText(one(price.vehicle_formats), "name");
      return {
        label: text(price, "pricing_label", vehicleFormat ?? "Tous formats"),
        vehicleFormat,
        minimumVehicleCount: nullableNumber(price, "minimum_vehicle_count") ?? undefined,
        maximumVehicleCount: nullableNumber(price, "maximum_vehicle_count") ?? undefined,
        amount: number(price, "amount_cents"),
        maximumAmount: number(price, "maximum_amount_cents", number(price, "amount_cents")),
      };
    }).sort((left, right) => (left.minimumVehicleCount ?? 0) - (right.minimumVehicleCount ?? 0)),
    targetDurationMinutes: number(row, "target_duration_minutes"), targetProductCost: number(row, "target_product_cost_cents"), targetTravelCost: number(row, "target_travel_cost_cents"), targetHourlyMargin: number(row, "target_hourly_margin_cents"),
    vatRateBasisPoints: number(row, "vat_rate_basis_points", 2000), active: bool(row, "active", true), archivedAt: optionalText(row, "archived_at"), displayOrder: number(row, "display_order"), aliases: rows(row.service_aliases).map((alias) => text(alias, "alias")), recommendedWorkers: number(row, "recommended_workers", 1), photosRequired: bool(row, "photos_required"),
  }));
  const quotes: Quote[] = quoteRows.map((row) => ({
    ...base(row), number: text(row, "number"), clientId: text(row, "client_id"), status: text(row, "status", "imported") as Quote["status"], issuedAt: text(row, "issued_at", text(row, "created_at")), validUntil: optionalText(row, "valid_until"),
    totalExcludingTax: number(row, "total_excluding_tax_cents"), totalTax: number(row, "total_tax_cents"), totalIncludingTax: number(row, "total_including_tax_cents"), lines: documentLines(row.quote_items), paymentTerms: optionalText(row, "payment_terms"), acceptedAt: optionalText(row, "accepted_at"), nextFollowUpAt: optionalText(row, "next_follow_up_at"),
  }));
  const invoices: Invoice[] = invoiceRows.map((row) => ({
    ...base(row), number: text(row, "number"), clientId: text(row, "client_id"), quoteId: optionalText(row, "quote_id"), status: text(row, "status", "imported") as Invoice["status"], paymentStatus: text(row, "payment_status", "unpaid") as Invoice["paymentStatus"],
    issuedAt: text(row, "issued_at", text(row, "created_at")), dueAt: optionalText(row, "due_at"), totalExcludingTax: number(row, "total_excluding_tax_cents"), totalTax: number(row, "total_tax_cents"), totalIncludingTax: number(row, "total_including_tax_cents"), lines: documentLines(row.invoice_items), expectedPaymentMethod: optionalText(row, "expected_payment_method"),
  }));
  const payments: Payment[] = paymentRows.map((row) => ({ ...base(row), invoiceId: optionalText(row, "invoice_id"), interventionId: optionalText(row, "intervention_id"), amount: number(row, "amount_cents"), paidAt: iso(text(row, "paid_at")), method: text(row, "method"), reference: optionalText(row, "reference"), notes: optionalText(row, "notes") }));
  const interventions: Intervention[] = interventionRows.map((row) => ({
    ...base(row), clientId: text(row, "client_id"), vehicleId: optionalText(row, "vehicle_id"), vehicleFormat: optionalText(row, "vehicle_format"), quoteId: optionalText(row, "quote_id"), invoiceId: optionalText(row, "invoice_id"), status: text(row, "status", "to_schedule") as Intervention["status"], title: text(row, "title"), startAt: optionalText(row, "start_at"), endAt: optionalText(row, "end_at"), plannedDurationMinutes: number(row, "planned_duration_minutes"), actualDurationMinutes: nullableNumber(row, "actual_duration_minutes"), preparationMinutes: number(row, "preparation_minutes"), cleanupMinutes: number(row, "cleanup_minutes"),
    workers: rows(row.intervention_workers).map((worker) => ({ memberId: text(worker, "profile_id", text(worker, "pending_member_id")), plannedMinutes: number(worker, "planned_minutes"), actualMinutes: nullableNumber(worker, "actual_minutes") })),
    items: rows(row.intervention_items).map((item) => ({ id: text(item, "id"), serviceId: optionalText(item, "service_id"), label: text(item, "label"), revenueAllocated: number(item, "revenue_allocated_cents"), quantity: number(item, "quantity", 1) })),
    productCost: number(row, "product_cost_cents"), travelCost: number(row, "travel_cost_cents"), otherDirectCosts: number(row, "other_direct_costs_cents"), address: text(row, "address"), checklistDone: rows(row.intervention_checklist_items).filter((item) => bool(item, "completed")).length, checklistTotal: rows(row.intervention_checklist_items).length, depositAmount: number(row, "deposit_amount_cents"), notes: optionalText(row, "notes"),
  }));
  const expenses: Expense[] = expenseRows.map((row) => ({
    ...base(row), date: text(row, "expense_date"), family: text(row, "family", "variable") as Expense["family"], category: text(row, "category"), supplier: text(row, "supplier"), description: text(row, "description"), amountIncludingTax: number(row, "amount_including_tax_cents"), amountExcludingTax: number(row, "amount_excluding_tax_cents"), vatAmount: number(row, "vat_amount_cents"), vatRecoverable: bool(row, "vat_recoverable"), recurrence: text(row, "recurrence", "one_off") as Expense["recurrence"], allocatedMonth: text(row, "allocated_month").slice(0, 7), paid: bool(row, "paid"), paidAt: optionalText(row, "paid_at"), paymentMethod: optionalText(row, "payment_method"),
  }));
  const assets: Asset[] = assetRows.map((row) => ({ ...base(row), name: text(row, "name"), category: text(row, "category"), status: text(row, "status", "to_buy") as Asset["status"], priority: text(row, "priority", "medium") as Asset["priority"], priceIncludingTax: number(row, "price_including_tax_cents"), expectedTimeGainMinutes: number(row, "expected_time_gain_minutes"), expectedMonthlyRevenue: number(row, "monthly_revenue_required_cents"), supplier: optionalText(row, "supplier"), commissionedAt: optionalText(row, "commissioned_on") }));
  const objectives: MonthlyObjective[] = objectiveRows.map((row) => ({ ...base(row), month: text(row, "month").slice(0, 7), revenueTarget: number(row, "revenue_target_cents"), interventionTarget: number(row, "intervention_target"), averageBasketTarget: number(row, "average_basket_target_cents"), hourlyMarginTarget: number(row, "hourly_margin_target_cents"), reviewTarget: number(row, "review_target"), note: optionalText(row, "note") }));
  const reviews: Review[] = reviewRows.map((row) => ({ ...base(row), clientId: text(row, "client_id"), interventionId: text(row, "intervention_id"), requestedAt: optionalText(row, "requested_at"), receivedAt: optionalText(row, "received_at"), rating: nullableNumber(row, "rating"), comment: optionalText(row, "comment"), url: optionalText(row, "url"), contentAuthorized: bool(row, "content_authorized") }));
  const activities: Activity[] = activityRows.map((row) => {
    const candidate = text(row, "kind") as Activity["kind"];
    return { ...base(row), kind: activityKinds.has(candidate) ? candidate : "comment_added", title: text(row, "title"), description: text(row, "description"), actorId: text(row, "actor_id", user.id), occurredAt: iso(text(row, "occurred_at")), entityType: optionalText(row, "entity_type"), entityId: optionalText(row, "entity_id") };
  });
  const messages: Message[] = messageRows.map((row) => {
    const conversation = one(row.conversations);
    const createdAt = iso(text(row, "created_at"));
    const readBy = rows(conversation.conversation_members)
      .filter((member) => text(member, "last_read_at") && new Date(text(member, "last_read_at")) >= new Date(createdAt))
      .map((member) => text(member, "profile_id"));
    return { ...base(row), channel: text(conversation, "kind", "general") as Message["channel"], entityType: optionalText(conversation, "entity_type") as Message["entityType"], entityId: optionalText(conversation, "entity_id"), authorId: text(row, "author_id"), body: text(row, "body"), sentAt: createdAt, editedAt: optionalText(row, "edited_at"), deletedAt: optionalText(row, "deleted_at"), readBy };
  });

  const settingsMap = new Map(settingRows.map((row) => [text(row, "key"), row.value]));
  const settings: AppSettings = {
    organizationName: text(organization, "name", "Mon entreprise"), locationName: text(location, "name", "Établissement principal"), locationCity: text(location, "city"),
    pilotYear: settingNumber(settingsMap, "pilot_year", new Date().getFullYear()), initialCash: settingNumber(settingsMap, "initial_cash_cents", 0), standardVatBasisPoints: settingNumber(settingsMap, "standard_vat_basis_points", 2000),
    dailyAvailableMinutes: settingNumber(settingsMap, "daily_available_minutes", 420), hourlyMarginTarget: settingNumber(settingsMap, "hourly_margin_target_cents", 6000), averageBasketTarget: settingNumber(settingsMap, "average_basket_target_cents", 30000),
    conversionTargetBasisPoints: settingNumber(settingsMap, "conversion_target_basis_points", 5000), monthlyReviewTarget: settingNumber(settingsMap, "monthly_review_target", 8), googleRatingTarget: settingNumber(settingsMap, "google_rating_target", 4.8), reviewRateTargetBasisPoints: settingNumber(settingsMap, "review_rate_target_basis_points", 5000), cashSafetyBuffer: settingNumber(settingsMap, "cash_safety_buffer_cents", 300000),
    leadSources: sourceRows.map((row) => text(row, "name")), lostReasons: settingStrings(settingsMap, "lost_reasons", ["Budget", "Délai", "Concurrence", "Sans réponse", "Projet reporté", "Autre"]), vehicleFormats: formatRows.map((row) => text(row, "name")),
  };
  const workspace: WorkspaceIdentity = {
    userId: user.id, email: user.email ?? text(currentProfile, "email"), firstName: text(currentProfile, "first_name", "Utilisateur"), lastName: text(currentProfile, "last_name"),
    organizationId, organizationName: text(organization, "name", "Mon entreprise"), organizationSlug: text(organization, "slug"), locationId, locationName: text(location, "name", "Établissement principal"), locationCity: text(location, "city"), role: text(membership, "role", "employee") as MemberRole,
    organizations: memberships.map((item) => ({ id: text(item, "organization_id"), name: text(one(item.organizations), "name", "Entreprise"), role: text(item, "role", "employee") as MemberRole })),
    canManageTeam: ["admin", "partner"].includes(text(membership, "role")),
  };
  const invitations: TeamInvitation[] = invitationRows.map((row) => ({
    id: text(row, "id"),
    memberId: optionalText(row, "pending_member_id"),
    firstName: text(row, "invited_first_name"),
    lastName: text(row, "invited_last_name"),
    email: text(row, "email"),
    role: text(row, "role", "employee") as TeamInvitation["role"],
    weeklyCapacityMinutes: number(row, "weekly_capacity_minutes", 2100),
    expiresAt: iso(text(row, "expires_at")),
    acceptedAt: optionalText(row, "accepted_at"),
    revokedAt: optionalText(row, "revoked_at"),
    createdAt: iso(text(row, "created_at")),
  }));
  return { workspace, invitations, data: { team, clients, vehicles, leads, services, quotes, invoices, payments, interventions, expenses, assets, objectives, reviews, activities, messages, settings } };
}
