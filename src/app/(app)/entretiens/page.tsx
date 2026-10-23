"use client";

import {
  Banknote,
  BellRing,
  CalendarCheck2,
  CalendarPlus2,
  CheckCircle2,
  Coins,
  MapPinned,
  Pencil,
  RefreshCw,
  Repeat2,
  Route,
  Save,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import {
  maintenanceAnnualValue,
  maintenanceCollectionSummary,
  maintenanceMonthlyRevenue,
  maintenanceRenewalStatus,
  maintenanceRouteGroups,
  maintenanceTermEndDate,
  nextMaintenanceVisit,
} from "@/lib/domain/maintenance";
import { suggestedServicePrice } from "@/lib/domain/service-pricing";
import type { MaintenanceBillingPeriod, MaintenanceContract } from "@/lib/domain/types";
import { useDemoStore, type MaintenanceContractInput } from "@/lib/demo/store";
import { formatDate, formatMoney } from "@/lib/utils";

const billingLabels = { monthly: "Paiement mensuel", annual: "Paiement annuel", prepaid: "Paiement unique" } as const;
const statusLabels = { active: "Actif", paused: "En pause", ended: "Terminé" } as const;

function billingLabel(contract: Pick<MaintenanceContract, "billingFrequency" | "termMonths">) {
  return contract.billingFrequency === "prepaid"
    ? `Paiement unique · ${contract.termMonths ?? 12} mois`
    : billingLabels[contract.billingFrequency];
}

function billingMonths(frequency: MaintenanceContract["billingFrequency"], termMonths: number) {
  return frequency === "monthly" ? 1 : frequency === "prepaid" ? termMonths : 12;
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addMonths(value: string, months: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return localDateKey(date);
}

function defaultFirstVisit() {
  const today = new Date();
  return today.getDate() <= 28
    ? localDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12))
    : localDateKey(new Date(today.getFullYear(), today.getMonth() + 1, 1, 12));
}

function clientName(client: { company?: string; firstName: string; lastName: string } | undefined) {
  return client?.company || `${client?.firstName ?? ""} ${client?.lastName ?? ""}`.trim() || "Client inconnu";
}

function ContractForm({ contract, onCancel, onSave }: { contract?: MaintenanceContract; onCancel: () => void; onSave: (input: MaintenanceContractInput) => Promise<void> }) {
  const data = useDemoStore();
  const clients = data.clients.filter((client) => !client.archivedAt);
  const services = data.services.filter((service) => service.active && service.kind === "subscription");
  const members = data.team.filter((member) => member.active);
  const financialTermsLocked = Boolean(contract && (
    data.maintenanceBillingPeriods.some((period) => period.contractId === contract.id && period.status === "paid")
    || data.interventions.some((intervention) => intervention.maintenanceContractId === contract.id && (intervention.status === "completed" || Boolean(intervention.startAt && intervention.startAt.slice(0, 10) < localDateKey())))
  ));
  const defaultClient = clients.find((client) => client.id === contract?.clientId) ?? clients[0];
  const defaultService = services.find((service) => service.id === contract?.serviceId) ?? services[0];
  const defaultPrice = suggestedServicePrice(defaultService, { vehicleCount: contract?.vehicleCount ?? 1 });
  const [clientId, setClientId] = useState(contract?.clientId ?? defaultClient?.id ?? "");
  const [serviceId, setServiceId] = useState(contract?.serviceId ?? defaultService?.id ?? "");
  const [title, setTitle] = useState(contract?.title ?? defaultService?.name ?? "Entretien mensuel");
  const [status, setStatus] = useState<MaintenanceContract["status"]>(contract?.status ?? "active");
  const [billingFrequency, setBillingFrequency] = useState<MaintenanceContract["billingFrequency"]>(contract?.billingFrequency ?? "monthly");
  const [termMonths, setTermMonths] = useState(contract?.termMonths ?? 6);
  const [renewalReminderDays, setRenewalReminderDays] = useState(contract?.renewalReminderDays ?? 30);
  const [billingAmountEuros, setBillingAmountEuros] = useState((contract?.billingAmount ?? defaultPrice?.minimumAmount ?? 0) / 100);
  const [vehicleCount, setVehicleCount] = useState(contract?.vehicleCount ?? 1);
  const [firstVisitOn, setFirstVisitOn] = useState(contract?.firstVisitOn ?? defaultFirstVisit());
  const [preferredStartTime, setPreferredStartTime] = useState(contract?.preferredStartTime ?? "09:00");
  const [durationHours, setDurationHours] = useState((contract?.plannedDurationMinutes ?? defaultService?.targetDurationMinutes ?? 120) / 60);
  const [memberId, setMemberId] = useState(contract?.assignedMemberIds[0] ?? members[0]?.id ?? "");
  const [address, setAddress] = useState(contract?.address ?? [defaultClient?.address, defaultClient?.postalCode, defaultClient?.city].filter(Boolean).join(" "));
  const [notes, setNotes] = useState(contract?.notes ?? "");
  const [endsOn, setEndsOn] = useState(contract?.endsOn ?? "");
  const [saving, setSaving] = useState(false);

  const selectedService = services.find((service) => service.id === serviceId);
  const suggestion = suggestedServicePrice(selectedService, { vehicleCount });
  const suggestedPeriodAmount = suggestion ? suggestion.minimumAmount / 100 * billingMonths(billingFrequency, termMonths) : 0;
  const fixedTermEnd = billingFrequency === "prepaid"
    ? contract?.billingFrequency === "prepaid" && contract.firstVisitOn === firstVisitOn && contract.termMonths === termMonths && contract.endsOn
      ? contract.endsOn
      : maintenanceTermEndDate(firstVisitOn, termMonths)
    : undefined;

  const selectClient = (nextClientId: string) => {
    setClientId(nextClientId);
    const client = clients.find((item) => item.id === nextClientId);
    setAddress([client?.address, client?.postalCode, client?.city].filter(Boolean).join(" "));
  };
  const selectService = (nextServiceId: string) => {
    setServiceId(nextServiceId);
    const service = services.find((item) => item.id === nextServiceId);
    if (service) {
      setTitle(service.name);
      setDurationHours(service.targetDurationMinutes / 60);
      const price = suggestedServicePrice(service, { vehicleCount });
      if (price) setBillingAmountEuros(price.minimumAmount / 100 * billingMonths(billingFrequency, termMonths));
    }
  };
  const selectBillingFrequency = (nextFrequency: MaintenanceContract["billingFrequency"]) => {
    const previousMonths = billingMonths(billingFrequency, termMonths);
    const nextMonths = billingMonths(nextFrequency, termMonths);
    setBillingAmountEuros((amount) => Math.round(amount / previousMonths * nextMonths * 100) / 100);
    setBillingFrequency(nextFrequency);
  };
  const selectTermMonths = (nextTerm: number) => {
    const safeTerm = Math.min(36, Math.max(1, Math.round(nextTerm)));
    if (billingFrequency === "prepaid") {
      setBillingAmountEuros((amount) => Math.round(amount / termMonths * safeTerm * 100) / 100);
    }
    setTermMonths(safeTerm);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const visitDay = Number(firstVisitOn.slice(8, 10));
    if (!clientId) return toast.error("Sélectionnez un client.");
    if (!memberId) return toast.error("Sélectionnez un collaborateur.");
    if (!firstVisitOn || visitDay < 1 || visitDay > 28) return toast.error("Choisissez une première visite entre le 1er et le 28 du mois pour garantir une date chaque mois.");
    if (title.trim().length < 2) return toast.error("Indiquez le nom de l’entretien.");
    if (!Number.isFinite(billingAmountEuros) || billingAmountEuros <= 0) return toast.error("Indiquez un montant supérieur à zéro.");
    if (!Number.isFinite(durationHours) || durationHours < 0.25) return toast.error("La durée minimale est de 15 minutes.");
    setSaving(true);
    try {
      await onSave({
        clientId,
        serviceId: serviceId || undefined,
        title: title.trim(),
        status,
        billingFrequency,
        billingAmount: Math.round(billingAmountEuros * 100),
        termMonths: billingFrequency === "prepaid" ? termMonths : undefined,
        renewalReminderDays,
        vehicleCount,
        firstVisitOn,
        preferredStartTime,
        plannedDurationMinutes: Math.round(durationHours * 60),
        assignedMemberIds: [memberId],
        address: address.trim(),
        notes: notes.trim(),
        endsOn: billingFrequency === "prepaid" ? fixedTermEnd : endsOn || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="grid gap-5" onSubmit={submit}>
      {services.length === 0 && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><strong>Ajoutez d’abord une formule « Abonnement » dans le Catalogue.</strong> Vous pouvez néanmoins préparer le contrat avec un intitulé libre.</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client"><Select autoFocus value={clientId} onChange={(event) => selectClient(event.target.value)}><option value="">Sélectionner…</option>{clients.map((client) => <option key={client.id} value={client.id}>{clientName(client)}</option>)}</Select></Field>
        <Field label="Formule d’abonnement" hint="Facultatif si l’entretien est entièrement personnalisé."><Select value={serviceId} onChange={(event) => selectService(event.target.value)}><option value="">Entretien personnalisé</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</Select></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_150px]">
        <Field label="Nom du contrat"><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Entretien mensuel de la flotte" /></Field>
        <Field label="Nombre de véhicules"><Input type="number" min="1" max="1000" value={vehicleCount} onChange={(event) => setVehicleCount(Math.max(1, Number(event.target.value)))} /></Field>
      </div>
      <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
        <p className="text-sm font-bold text-sky-950">Facturation du contrat</p>
        <p className="mt-1 text-xs leading-5 text-sky-800">La visite reste mensuelle. Le client peut payer chaque mois, chaque année ou une seule fois pour une période fixe.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Rythme de paiement" hint={financialTermsLocked ? "Verrouillé car le contrat possède déjà un historique." : undefined}><Select disabled={financialTermsLocked} value={billingFrequency} onChange={(event) => selectBillingFrequency(event.target.value as MaintenanceContract["billingFrequency"])}><option value="monthly">Le client paie chaque mois</option><option value="annual">Le client paie une fois par an · renouvellement continu</option><option value="prepaid">Paiement unique · durée fixe</option></Select></Field>
          <Field label={billingFrequency === "monthly" ? "Montant TTC par mois (€)" : billingFrequency === "annual" ? "Montant TTC par an (€)" : `Montant TTC pour ${termMonths} mois (€)`}><Input type="number" min="0.01" step="0.01" value={billingAmountEuros} onChange={(event) => setBillingAmountEuros(Number(event.target.value))} /></Field>
        </div>
        {billingFrequency === "prepaid" && <div className="mt-4 grid gap-4 rounded-xl border border-violet-200 bg-violet-50/80 p-4 sm:grid-cols-2"><Field label="Nombre de mois payés" hint={financialTermsLocked ? "La durée du cycle payé ne peut plus être modifiée." : "Chaque mois payé crée exactement une prestation."}><Input disabled={financialTermsLocked} type="number" min={1} max={36} step={1} value={termMonths} onChange={(event) => selectTermMonths(Number(event.target.value))} /></Field><Field label="Relancer le client avant la fin"><Select value={renewalReminderDays} onChange={(event) => setRenewalReminderDays(Number(event.target.value))}><option value={15}>15 jours avant</option><option value={30}>30 jours avant</option><option value={45}>45 jours avant</option><option value={60}>60 jours avant</option><option value={90}>90 jours avant</option></Select></Field><div className="sm:col-span-2 rounded-lg bg-white/80 px-3 py-2 text-xs text-violet-900"><strong>{termMonths} mois payés = {termMonths} prestations créées.</strong><span className="ml-1">Période couverte du {formatDate(firstVisitOn)} au {fixedTermEnd ? formatDate(fixedTermEnd) : "—"}, avec une seule échéance.</span></div></div>}
        {suggestion && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-white/70 px-3 py-2 text-xs text-sky-900"><span>Suggestion Catalogue : <strong>{formatMoney(Math.round(suggestedPeriodAmount * 100))}</strong> {billingFrequency === "monthly" ? "par mois" : billingFrequency === "annual" ? "par an" : `pour ${termMonths} mois`}</span><Button size="sm" variant="secondary" onClick={() => setBillingAmountEuros(suggestedPeriodAmount)}>Utiliser ce montant</Button></div>}
      </div>
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-bold text-emerald-950">Organisation des visites mensuelles</p>
        <p className="mt-1 text-xs leading-5 text-emerald-800">{billingFrequency === "prepaid" ? `${termMonths} prestations seront préparées, exactement sur la période payée.` : "Douze prestations seront préparées dans le planning."} Elles resteront déplaçables individuellement.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Première visite" hint={financialTermsLocked ? "La date d’origine est conservée pour protéger l’historique." : "Du 1er au 28 du mois"}><Input disabled={financialTermsLocked} type="date" value={firstVisitOn} onChange={(event) => setFirstVisitOn(event.target.value)} /></Field>
          <Field label="Heure habituelle"><Input type="time" value={preferredStartTime} onChange={(event) => setPreferredStartTime(event.target.value)} /></Field>
          <Field label="Durée par visite (h)"><Input type="number" min="0.25" max="24" step="0.25" value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value))} /></Field>
          <Field label="Collaborateur principal"><Select value={memberId} onChange={(event) => setMemberId(event.target.value)}><option value="">Sélectionner…</option>{members.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName}</option>)}</Select></Field>
        </div>
      </div>
      <Field label="Adresse d’intervention"><Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Adresse, code postal, ville" /></Field>
      {contract && <div className="grid gap-4 sm:grid-cols-2"><Field label="État du contrat"><Select value={status} onChange={(event) => setStatus(event.target.value as MaintenanceContract["status"])}><option value="active">Actif</option><option value="paused">En pause</option><option value="ended">Terminé</option></Select></Field>{billingFrequency === "prepaid" ? <Field label="Fin de la période payée"><Input readOnly value={fixedTermEnd ?? ""} /></Field> : <Field label="Date de fin" hint="Facultative"><Input type="date" min={firstVisitOn} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></Field>}</div>}
      <Field label="Consignes internes" hint="Facultatif"><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Accès, contact sur place, contraintes logistiques…" /></Field>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>Annuler</Button><Button type="submit" disabled={saving}><Save className="size-4" /> {saving ? "Enregistrement…" : contract ? "Mettre à jour le contrat" : billingFrequency === "prepaid" ? `Créer le forfait de ${termMonths} mois` : "Créer et planifier 12 mois"}</Button></div>
    </form>
  );
}

export default function EntretiensPage() {
  const data = useDemoStore();
  const { mode, workspace, refresh } = useWorkspace();
  const canManage = mode === "demo" || Boolean(workspace?.canManageBusiness);
  const [editingContract, setEditingContract] = useState<MaintenanceContract | "new" | null>(null);
  const [deletingContract, setDeletingContract] = useState<MaintenanceContract | null>(null);
  const [paymentPeriod, setPaymentPeriod] = useState<MaintenanceBillingPeriod | null>(null);
  const [paymentDate, setPaymentDate] = useState(localDateKey());
  const [paymentMethod, setPaymentMethod] = useState("Virement");
  const [busyId, setBusyId] = useState<string | null>(null);
  const today = localDateKey();
  const currentMonth = today.slice(0, 7);
  const visibleContracts = canManage || !workspace
    ? data.maintenanceContracts
    : data.maintenanceContracts.filter((contract) => contract.assignedMemberIds.includes(workspace.userId));
  const visibleContractIds = new Set(visibleContracts.map((contract) => contract.id));
  const visibleBillingPeriods = data.maintenanceBillingPeriods.filter((period) => visibleContractIds.has(period.contractId));
  const activeContracts = visibleContracts.filter((contract) => contract.status === "active" && (contract.billingFrequency !== "prepaid" || !contract.endsOn || contract.endsOn >= today));
  const mrr = activeContracts.reduce((sum, contract) => sum + maintenanceMonthlyRevenue(contract), 0);
  const annualValue = activeContracts.reduce((sum, contract) => sum + maintenanceAnnualValue(contract), 0);
  const monthlyVisits = data.interventions.filter((intervention) => intervention.maintenanceContractId && visibleContractIds.has(intervention.maintenanceContractId) && intervention.startAt?.slice(0, 7) === currentMonth && intervention.status !== "cancelled");
  const completedVisits = monthlyVisits.filter((intervention) => intervention.status === "completed").length;
  const collection = maintenanceCollectionSummary(visibleBillingPeriods);
  const upcomingVisits = data.interventions
    .filter((intervention) => intervention.maintenanceContractId && visibleContractIds.has(intervention.maintenanceContractId) && intervention.startAt && intervention.startAt.slice(0, 10) >= today && intervention.status !== "cancelled")
    .sort((left, right) => left.startAt!.localeCompare(right.startAt!))
    .slice(0, 12);
  const routes = maintenanceRouteGroups(data.interventions.filter((intervention) => !intervention.maintenanceContractId || visibleContractIds.has(intervention.maintenanceContractId)), visibleContracts, data.clients).slice(0, 8);
  const coverageAlertDate = addMonths(today, 2);
  const contractsToExtend = activeContracts.filter((contract) => contract.billingFrequency !== "prepaid" && (!contract.generatedThrough || contract.generatedThrough < coverageAlertDate));
  const renewalContracts = visibleContracts
    .map((contract) => ({ contract, renewal: maintenanceRenewalStatus(contract) }))
    .filter((item) => item.renewal.state === "due" || item.renewal.state === "expired")
    .sort((left, right) => (left.renewal.daysRemaining ?? 0) - (right.renewal.daysRemaining ?? 0));

  const request = async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/maintenance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json() as { error?: string; generated?: number };
    if (!response.ok) throw new Error(result.error || "Enregistrement impossible.");
    if (payload.action !== "setPayment") {
      void fetch("/api/integrations/google/sync", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
    }
    await refresh();
    return result;
  };

  const saveContract = async (contract: MaintenanceContract | undefined, input: MaintenanceContractInput) => {
    try {
      if (mode === "demo") data.saveMaintenanceContract(contract?.id, input);
      else await request({ action: contract ? "update" : "create", contractId: contract?.id, ...input, serviceId: input.serviceId ?? null, endsOn: input.endsOn ?? null });
      setEditingContract(null);
      toast.success(contract ? "Contrat mis à jour" : "Entretien mensuel créé", { description: contract ? "Les futures visites et échéances ont été recalculées." : input.billingFrequency === "prepaid" ? `Les ${input.termMonths} visites couvertes sont déjà dans le planning.` : "Les douze prochaines visites sont déjà dans le planning." });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible.");
      throw error;
    }
  };

  const extendContract = async (contract: MaintenanceContract) => {
    setBusyId(contract.id);
    try {
      const through = addMonths(contract.generatedThrough ?? contract.firstVisitOn, 12);
      const generated = mode === "demo" ? data.generateMaintenanceSchedule(contract.id, through) : (await request({ action: "generate", contractId: contract.id, through })).generated ?? 0;
      toast.success("Planning prolongé", { description: `${generated} nouvelle(s) visite(s) préparée(s).` });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Planification impossible."); }
    finally { setBusyId(null); }
  };

  const renewContract = async (contract: MaintenanceContract) => {
    setBusyId(contract.id);
    try {
      const generated = mode === "demo" ? data.renewMaintenanceContract(contract.id) : (await request({ action: "renew", contractId: contract.id })).generated ?? 0;
      toast.success(`Forfait prolongé de ${contract.termMonths ?? 12} mois`, { description: `${generated} nouvelle(s) visite(s) et une nouvelle échéance ont été préparées.` });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Renouvellement impossible."); }
    finally { setBusyId(null); }
  };

  const removeContract = async (contract: MaintenanceContract) => {
    setBusyId(contract.id);
    try {
      if (mode === "demo") data.removeMaintenanceContract(contract.id);
      else await request({ action: "archive", contractId: contract.id });
      setDeletingContract(null);
      toast.success("Entretien mensuel supprimé", { description: "Les rendez-vous futurs et les échéances non encaissées ont été annulés. L’historique réalisé et les paiements restent conservés." });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Suppression impossible."); }
    finally { setBusyId(null); }
  };

  const setPaid = async (period: MaintenanceBillingPeriod, paid: boolean) => {
    if (paid && !paymentDate) return toast.error("Choisissez la date du paiement.");
    setBusyId(period.id);
    try {
      const paidAt = new Date(`${paymentDate}T12:00:00`).toISOString();
      if (mode === "demo") data.setMaintenanceBillingPaid(period.id, paid, paidAt, paymentMethod);
      else await request({ action: "setPayment", periodId: period.id, paid, paidAt, method: paymentMethod });
      setPaymentPeriod(null);
      toast.success(paid ? "Encaissement enregistré" : "Encaissement annulé", { description: paid ? "Le chiffre d’affaires encaissé est actualisé." : "L’échéance repasse à encaisser." });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Modification impossible."); }
    finally { setBusyId(null); }
  };

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Récurrence & logistique" title="Entretiens mensuels" description="Pilotez les visites mensuelles, les forfaits prépayés de 6 ou 12 mois et les relances de renouvellement sans double saisie." actions={canManage ? <Button onClick={() => setEditingContract("new")}><CalendarPlus2 className="size-4" /> Nouvel entretien</Button> : undefined} />

      {contractsToExtend.length > 0 && <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950"><TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" /><div><p className="text-sm font-bold">{contractsToExtend.length} contrat(s) bientôt à court de planning</p><p className="mt-1 text-xs text-amber-800">Prolongez-les pour conserver au moins deux mois de visibilité opérationnelle.</p></div></div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[
          { icon: Repeat2, label: "Contrats actifs", value: String(activeContracts.length), detail: `${visibleContracts.length} contrat(s) au total`, tone: "text-violet-700" },
          { icon: Coins, label: "Revenu mensuel récurrent", value: formatMoney(mrr), detail: "annuels répartis sur 12 mois", tone: "text-emerald-700" },
          { icon: Banknote, label: "Valeur annualisée", value: formatMoney(annualValue), detail: "projection au rythme actuel", tone: "text-sky-700" },
          { icon: CalendarCheck2, label: "Visites ce mois", value: `${completedVisits}/${monthlyVisits.length}`, detail: "réalisées / prévues", tone: "text-orange-700" },
          { icon: BellRing, label: "Clients à relancer", value: String(renewalContracts.length), detail: "forfaits proches de leur fin", tone: renewalContracts.length ? "text-amber-700" : "text-emerald-700" },
          { icon: TriangleAlert, label: "Échéances en retard", value: formatMoney(collection.overdue), detail: `${formatMoney(collection.paid)} déjà encaissé`, tone: collection.overdue > 0 ? "text-red-700" : "text-emerald-700" },
        ].map((item) => <Card key={item.label}><CardContent className="p-5"><div className="flex items-start justify-between gap-2"><p className="text-xs font-semibold text-zinc-500">{item.label}</p><item.icon className={`size-4 ${item.tone}`} /></div><p className={`mt-4 text-2xl font-extrabold ${item.tone}`}>{item.value}</p><p className="mt-1 text-[10px] text-zinc-500">{item.detail}</p></CardContent></Card>)}
      </section>

      {renewalContracts.length > 0 && <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-white"><CardHeader><div><h2 className="flex items-center gap-2 font-bold text-amber-950"><BellRing className="size-4 text-amber-600" /> Relances de renouvellement</h2><p className="mt-1 text-xs text-amber-800">Contactez ces clients avant la dernière visite pour éviter une interruption de leur entretien.</p></div><Badge variant="yellow">{renewalContracts.length} à traiter</Badge></CardHeader><CardContent className="grid gap-2">{renewalContracts.map(({ contract, renewal }) => { const client = data.clients.find((item) => item.id === contract.clientId); const expired = renewal.state === "expired"; return <div key={contract.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-white p-4"><span className={`grid size-10 place-items-center rounded-xl ${expired ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}><BellRing className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-zinc-900">{clientName(client)}</p><p className="mt-1 text-xs text-zinc-600">{contract.title} · fin le {formatDate(contract.endsOn)} · {expired ? `expiré depuis ${Math.abs(renewal.daysRemaining ?? 0)} jour(s)` : `${renewal.daysRemaining} jour(s) restant(s)`}</p></div>{client?.phone && <a href={`tel:${client.phone}`} className="focus-ring rounded-lg px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100">Appeler</a>}{canManage && <Button size="sm" disabled={busyId === contract.id} onClick={() => void renewContract(contract)}><RefreshCw className={`size-3.5 ${busyId === contract.id ? "animate-spin" : ""}`} /> Prolonger de {contract.termMonths} mois</Button>}</div>; })}</CardContent></Card>}

      <Card>
        <CardHeader><div><h2 className="flex items-center gap-2 font-bold"><Repeat2 className="size-4 text-violet-600" /> Contrats d’entretien</h2><p className="mt-1 text-xs text-zinc-500">Une ligne pilote à la fois les visites mensuelles et le rythme de paiement du client.</p></div><Badge variant="blue">{activeContracts.length} actif(s)</Badge></CardHeader>
        <CardContent className="grid gap-3">
          {visibleContracts.map((contract) => {
            const client = data.clients.find((item) => item.id === contract.clientId);
            const member = data.team.find((item) => contract.assignedMemberIds.includes(item.id));
            const nextVisit = nextMaintenanceVisit(contract.id, data.interventions);
            const periods = data.maintenanceBillingPeriods.filter((period) => period.contractId === contract.id);
            const contractCollection = maintenanceCollectionSummary(periods);
            const renewal = maintenanceRenewalStatus(contract);
            const renewalAlert = renewal.state === "due" || renewal.state === "expired";
            return <div key={contract.id} className="grid gap-4 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 transition hover:border-violet-200 hover:bg-violet-50/30 lg:grid-cols-[minmax(220px,1.25fr)_180px_180px_180px_auto] lg:items-center">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-bold text-zinc-900">{contract.title}</p><Badge variant={renewal.state === "expired" ? "red" : renewal.state === "due" ? "yellow" : contract.status === "active" ? "green" : contract.status === "paused" ? "yellow" : "neutral"}>{renewal.state === "expired" ? "À renouveler" : renewal.state === "due" ? "Relance à faire" : statusLabels[contract.status]}</Badge></div><p className="mt-1 truncate text-xs text-zinc-500">{clientName(client)} · {contract.vehicleCount} véhicule(s)</p><p className="mt-2 flex items-center gap-1 text-[11px] text-zinc-600"><MapPinned className="size-3" /> {client?.city || contract.address || "Adresse à compléter"}</p></div>
              <div><p className="text-[10px] font-bold text-zinc-500 uppercase">Paiement</p><p className="mt-1 text-sm font-bold text-zinc-900">{formatMoney(contract.billingAmount)}</p><p className="mt-1 text-[10px] text-zinc-500">{billingLabel(contract)}</p>{contract.billingFrequency === "prepaid" && contract.endsOn && <p className={`mt-1 text-[10px] ${renewalAlert ? "font-bold text-amber-700" : "text-zinc-500"}`}>Couvert jusqu’au {formatDate(contract.endsOn)}</p>}</div>
              <div><p className="text-[10px] font-bold text-zinc-500 uppercase">Prochaine visite</p><p className="mt-1 text-sm font-bold text-zinc-900">{nextVisit?.startAt ? formatDate(nextVisit.startAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "À prolonger"}</p><p className="mt-1 text-[10px] text-zinc-500">{member ? `${member.firstName} ${member.lastName}` : "Équipe à vérifier"}</p></div>
              <div><p className="text-[10px] font-bold text-zinc-500 uppercase">Encaissements</p><p className="mt-1 text-sm font-bold text-emerald-700">{formatMoney(contractCollection.paid)}</p><p className={`mt-1 text-[10px] ${contractCollection.overdue ? "font-bold text-red-600" : "text-zinc-500"}`}>{contractCollection.overdue ? `${formatMoney(contractCollection.overdue)} en retard` : "Aucun retard"}</p></div>
              {canManage && <div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => setEditingContract(contract)}><Pencil className="size-3.5" /> Modifier</Button>{contract.billingFrequency === "prepaid" ? renewalAlert && <Button size="sm" variant="ghost" disabled={busyId === contract.id} onClick={() => void renewContract(contract)}><RefreshCw className={`size-3.5 ${busyId === contract.id ? "animate-spin" : ""}`} /> +{contract.termMonths} mois</Button> : <Button size="sm" variant="ghost" disabled={busyId === contract.id || contract.status !== "active"} onClick={() => void extendContract(contract)}><RefreshCw className={`size-3.5 ${busyId === contract.id ? "animate-spin" : ""}`} /> +12 mois</Button>}<Button size="icon" variant="danger" aria-label={`Supprimer ${contract.title}`} onClick={() => setDeletingContract(contract)}><Trash2 className="size-3.5" /></Button></div>}
            </div>;
          })}
          {visibleContracts.length === 0 && <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-10 text-center"><Repeat2 className="mx-auto size-7 text-zinc-400" /><p className="mt-3 text-sm font-bold text-zinc-800">Aucun entretien mensuel</p><p className="mt-1 text-xs text-zinc-500">{canManage ? "Créez un contrat : les visites et échéances seront préparées automatiquement." : "Aucun contrat d’entretien ne vous est affecté."}</p>{canManage && <Button className="mt-4" onClick={() => setEditingContract("new")}>Créer le premier contrat</Button>}</div>}
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <Card>
          <CardHeader><div><h2 className="flex items-center gap-2 font-bold"><CalendarCheck2 className="size-4 text-orange-600" /> Prochaines visites</h2><p className="mt-1 text-xs text-zinc-500">Elles apparaissent également dans le Planning et restent déplaçables.</p></div><Badge>{upcomingVisits.length} affichée(s)</Badge></CardHeader>
          <CardContent className="grid gap-2">
            {upcomingVisits.map((visit) => {
              const client = data.clients.find((item) => item.id === visit.clientId);
              const member = data.team.find((item) => visit.workers.some((worker) => worker.memberId === item.id));
              return <Link key={visit.id} href={`/prestations?intervention=${visit.id}`} className="focus-ring grid gap-3 rounded-xl border border-zinc-200 bg-white p-3 transition hover:border-orange-300 hover:bg-orange-50/50 sm:grid-cols-[130px_minmax(0,1fr)_auto] sm:items-center"><div><p className="text-xs font-bold text-zinc-900">{formatDate(visit.startAt!, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p><p className="mt-1 text-[10px] text-zinc-500">{visit.plannedDurationMinutes / 60} h</p></div><div className="min-w-0"><p className="truncate text-sm font-bold text-zinc-900">{clientName(client)}</p><p className="mt-1 truncate text-xs text-zinc-500">{visit.title} · {client?.city || visit.address}</p></div><Badge variant="blue">{member?.firstName ?? "Équipe"}</Badge></Link>;
            })}
            {upcomingVisits.length === 0 && <p className="rounded-xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500">Aucune visite à venir.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div><h2 className="flex items-center gap-2 font-bold"><Route className="size-4 text-emerald-600" /> Logistique des tournées</h2><p className="mt-1 text-xs text-zinc-500">Regroupement automatique par date et par ville sur les 60 prochains jours.</p></div></CardHeader>
          <CardContent className="grid gap-2">
            {routes.map((route) => <div key={route.key} className="rounded-xl border border-zinc-200 bg-zinc-50 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-zinc-900 capitalize">{formatDate(route.date, { weekday: "long", day: "2-digit", month: "long" })}</p><p className="mt-1 flex items-center gap-1 text-xs text-zinc-500"><MapPinned className="size-3" /> {route.city}</p></div><Badge variant={route.interventions.length > 1 ? "green" : "neutral"}>{route.interventions.length} visite(s)</Badge></div><div className="mt-3 flex items-center justify-between text-[11px] text-zinc-600"><span>{(route.totalMinutes / 60).toFixed(1).replace(".0", "")} h de prestation</span><span>{route.interventions.length > 1 ? "Tournée à optimiser ensemble" : "Trajet individuel"}</span></div></div>)}
            {routes.length === 0 && <p className="rounded-xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500">Les suggestions apparaîtront avec les prochaines visites.</p>}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader><div><h2 className="flex items-center gap-2 font-bold"><Banknote className="size-4 text-emerald-600" /> Échéancier des paiements</h2><p className="mt-1 text-xs text-zinc-500">Les encaissements alimentent directement le chiffre d’affaires et ne nécessitent aucune facture.</p></div><div className="text-right"><p className="text-lg font-extrabold text-emerald-700">{formatMoney(collection.paid)}</p><p className="text-[10px] text-zinc-500">encaissé</p></div></CardHeader>
        <CardContent className="overflow-x-auto px-0 pb-1">
          <table className="w-full min-w-[860px] text-left text-xs"><thead className="text-[10px] tracking-wider text-zinc-500 uppercase"><tr>{["Échéance", "Client", "Contrat", "Période", "Montant", "État", "Action"].map((head) => <th key={head} className="px-4 py-3 font-semibold first:pl-5">{head}</th>)}</tr></thead><tbody className="divide-y divide-zinc-100">
            {[...visibleBillingPeriods].sort((a, b) => b.dueOn.localeCompare(a.dueOn)).map((period) => {
              const contract = data.maintenanceContracts.find((item) => item.id === period.contractId);
              const client = data.clients.find((item) => item.id === contract?.clientId);
              const overdue = period.status === "due" && period.dueOn < today;
              return <tr key={period.id} className="hover:bg-zinc-50"><td className="px-4 py-4 pl-5 font-semibold">{formatDate(period.dueOn)}</td><td className="px-4 py-4">{clientName(client)}</td><td className="px-4 py-4 text-zinc-600">{contract?.title}</td><td className="px-4 py-4 text-zinc-500">{contract ? billingLabel(contract) : "—"}</td><td className="px-4 py-4 font-bold">{formatMoney(period.amount)}</td><td className="px-4 py-4"><Badge variant={period.status === "paid" ? "green" : overdue ? "red" : "yellow"}>{period.status === "paid" ? `Payé${period.paidAt ? ` · ${formatDate(period.paidAt)}` : ""}` : overdue ? "En retard" : "À venir"}</Badge></td><td className="px-4 py-4">{canManage && <Button size="sm" variant={period.status === "paid" ? "ghost" : "secondary"} disabled={busyId === period.id} onClick={() => { if (period.status === "paid") void setPaid(period, false); else { setPaymentDate(localDateKey()); setPaymentPeriod(period); } }}>{period.status === "paid" ? "Annuler le paiement" : "Marquer encaissé"}</Button>}</td></tr>;
            })}
            {visibleBillingPeriods.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-zinc-500">Aucune échéance pour le moment.</td></tr>}
          </tbody></table>
        </CardContent>
      </Card>

      <Modal open={editingContract !== null} onClose={() => setEditingContract(null)} title={editingContract === "new" ? "Créer un entretien mensuel" : "Modifier le contrat"} description="Visites mensuelles · paiement mensuel, annuel ou unique" className="sm:max-w-4xl">
        {editingContract && <ContractForm key={editingContract === "new" ? "new" : editingContract.id} contract={editingContract === "new" ? undefined : editingContract} onCancel={() => setEditingContract(null)} onSave={(input) => saveContract(editingContract === "new" ? undefined : editingContract, input)} />}
      </Modal>

      <Modal open={Boolean(deletingContract)} onClose={() => setDeletingContract(null)} title="Supprimer cet entretien mensuel ?" description={deletingContract ? `${deletingContract.title} · ${clientName(data.clients.find((client) => client.id === deletingContract.clientId))}` : undefined}>
        <div className="grid gap-4"><div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"><p className="font-bold">Cette action arrête définitivement ce contrat.</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs"><li>les rendez-vous futurs non réalisés seront supprimés du planning ;</li><li>les échéances non encaissées seront annulées ;</li><li>les prestations déjà réalisées et les paiements encaissés resteront dans les statistiques et l’historique.</li></ul></div><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDeletingContract(null)}>Conserver</Button><Button variant="danger" disabled={!deletingContract || busyId === deletingContract.id} onClick={() => deletingContract && void removeContract(deletingContract)}><Trash2 className="size-4" /> {busyId === deletingContract?.id ? "Suppression…" : "Supprimer l’entretien"}</Button></div></div>
      </Modal>

      <Modal open={Boolean(paymentPeriod)} onClose={() => setPaymentPeriod(null)} title="Enregistrer l’encaissement" description={paymentPeriod ? `${formatMoney(paymentPeriod.amount)} · échéance du ${formatDate(paymentPeriod.dueOn)}` : undefined}>
        <div className="grid gap-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Date du paiement"><Input type="date" max={localDateKey()} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></Field><Field label="Moyen de paiement"><Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option>Virement</option><option>Carte bancaire</option><option>Prélèvement</option><option>Espèces</option><option>Chèque</option><option>Autre</option></Select></Field></div><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-5 text-emerald-900"><CheckCircle2 className="mr-2 inline size-4" />Cet encaissement sera ajouté au chiffre d’affaires réel, sans rendre une facture obligatoire.</div><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setPaymentPeriod(null)}>Annuler</Button><Button disabled={!paymentPeriod || busyId === paymentPeriod.id} onClick={() => paymentPeriod && void setPaid(paymentPeriod, true)}><Banknote className="size-4" /> Valider l’encaissement</Button></div></div>
      </Modal>
    </div>
  );
}

