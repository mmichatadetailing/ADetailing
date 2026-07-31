"use client";

import {
  AlertTriangle,
  CalendarCheck2,
  Camera,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  FileUp,
  MapPin,
  Pencil,
  Phone,
  Play,
  Plus,
  ReceiptText,
  Save,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/avatar";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { grossMargin, hourlyMargin, paymentStatusForInvoice } from "@/lib/domain/calculations";
import { getInterventionWorkflow, type WorkflowStepId } from "@/lib/domain/intervention-workflow";
import { interventionStatusLabels, paymentStatusLabels } from "@/lib/domain/labels";
import type { InterventionStatus } from "@/lib/domain/types";
import { useDemoStore } from "@/lib/demo/store";
import { formatDate, formatMoney } from "@/lib/utils";

const stepIcons = { appointment: CalendarCheck2, service: Sparkles, invoice: ReceiptText, payment: CircleDollarSign } satisfies Record<WorkflowStepId, typeof CalendarCheck2>;

function localDateParts(value?: string) {
  if (!value) return { date: "", time: "" };
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function hours(minutes: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(minutes / 60);
}

type EditableLine = { id?: string; serviceId: string; label: string; quantity: number; revenueAllocated: number; revenueEuros: number };

export function InterventionDetail({ interventionId }: { interventionId: string }) {
  const data = useDemoStore();
  const current = data.interventions.find((item) => item.id === interventionId);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [photos, setPhotos] = useState<Array<{ name: string; size: number }>>([]);
  const initialDate = localDateParts(current?.startAt);
  const [title, setTitle] = useState(current?.title ?? "");
  const [clientId, setClientId] = useState(current?.clientId ?? "");
  const [vehicleId, setVehicleId] = useState(current?.vehicleId ?? "");
  const [status, setStatusDraft] = useState<InterventionStatus>(current?.status ?? "to_schedule");
  const [startDate, setStartDate] = useState(initialDate.date);
  const [startTime, setStartTime] = useState(initialDate.time);
  const [plannedHours, setPlannedHours] = useState((current?.plannedDurationMinutes ?? 120) / 60);
  const [address, setAddress] = useState(current?.address ?? "");
  const [notes, setNotes] = useState(current?.notes ?? "");
  const [workerHours, setWorkerHours] = useState<Record<string, number>>(
    Object.fromEntries((current?.workers ?? []).map((worker) => [worker.memberId, worker.plannedMinutes / 60])),
  );
  const [items, setItems] = useState<EditableLine[]>((current?.items ?? []).map((item) => ({ ...item, serviceId: item.serviceId ?? "", revenueEuros: item.revenueAllocated / 100 })));
  const [actualHours, setActualHours] = useState((current?.actualDurationMinutes ?? current?.plannedDurationMinutes ?? 0) / 60);
  const [productEuros, setProductEuros] = useState((current?.productCost ?? 0) / 100);
  const [travelEuros, setTravelEuros] = useState((current?.travelCost ?? 0) / 100);
  const [otherEuros, setOtherEuros] = useState((current?.otherDirectCosts ?? 0) / 100);
  const [actualWorkerHours, setActualWorkerHours] = useState<Record<string, number>>(
    Object.fromEntries((current?.workers ?? []).map((worker) => [worker.memberId, (worker.actualMinutes ?? worker.plannedMinutes) / 60])),
  );
  const [invoiceChoice, setInvoiceChoice] = useState("");
  const [paymentEuros, setPaymentEuros] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("Carte");

  if (!current) return <p className="rounded-2xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500">Cette prestation n’existe plus ou n’est pas accessible.</p>;

  const client = data.clients.find((item) => item.id === current.clientId);
  const vehicle = data.vehicles.find((item) => item.id === current.vehicleId);
  const invoice = data.invoices.find((item) => item.id === current.invoiceId);
  const workflow = getInterventionWorkflow(current, invoice, data.payments);
  const margin = grossMargin(current);
  const hourly = hourlyMargin(current);
  const clientVehicles = data.vehicles.filter((item) => item.clientId === clientId);
  const eligibleInvoices = data.invoices.filter((item) => item.clientId === current.clientId && item.status !== "cancelled" && !data.interventions.some((intervention) => intervention.id !== current.id && intervention.invoiceId === item.id));

  const toggleWorker = (memberId: string) => {
    setWorkerHours((state) => state[memberId] === undefined ? { ...state, [memberId]: plannedHours } : Object.fromEntries(Object.entries(state).filter(([id]) => id !== memberId)));
  };

  const chooseClient = (nextClientId: string) => {
    const nextClient = data.clients.find((item) => item.id === nextClientId);
    setClientId(nextClientId);
    setVehicleId(data.vehicles.find((item) => item.clientId === nextClientId)?.id ?? "");
    setAddress(nextClient ? [nextClient.address, nextClient.postalCode, nextClient.city].filter(Boolean).join(" ") : "");
  };

  const chooseService = (index: number, serviceId: string) => {
    const service = data.services.find((item) => item.id === serviceId);
    setItems((lines) => lines.map((line, lineIndex) => lineIndex === index ? { ...line, serviceId, label: service?.name ?? line.label, revenueEuros: (service?.prices.find((price) => price.vehicleFormat === data.vehicles.find((item) => item.id === vehicleId)?.format)?.amount ?? service?.prices[0]?.amount ?? line.revenueAllocated) / 100 } : line));
  };

  const saveDetails = () => {
    if (title.trim().length < 2) return toast.error("Donnez un titre à la prestation");
    if (!clientId || !vehicleId) return toast.error("Le client et son véhicule sont requis");
    if (!Number.isFinite(plannedHours) || plannedHours < 0.25 || plannedHours > 24) return toast.error("La durée prévue doit être comprise entre 15 minutes et 24 heures");
    if (Object.keys(workerHours).length === 0) return toast.error("Affectez au moins un collaborateur");
    if (items.length === 0 || items.some((item) => item.label.trim().length < 2 || item.quantity <= 0 || item.revenueEuros < 0)) return toast.error("Vérifiez les lignes de prestation");
    const startAt = startDate && startTime ? new Date(`${startDate}T${startTime}`).toISOString() : undefined;
    data.updateIntervention(current.id, {
      clientId,
      vehicleId,
      title: title.trim(),
      status,
      startAt,
      plannedDurationMinutes: Math.round(plannedHours * 60),
      address,
      notes,
      workers: Object.entries(workerHours).map(([memberId, value]) => ({ memberId, plannedMinutes: Math.round(value * 60) })),
      items: items.map((item) => ({ id: item.id, serviceId: item.serviceId || undefined, label: item.label.trim(), quantity: item.quantity, revenueAllocated: Math.round(item.revenueEuros * 100) })),
    });
    setEditing(false);
    toast.success("Prestation mise à jour");
  };

  const finishService = () => {
    if ([actualHours, productEuros, travelEuros, otherEuros, ...Object.values(actualWorkerHours)].some((value) => !Number.isFinite(value) || value < 0)) return toast.error("Les durées et les coûts doivent être positifs");
    data.updateInterventionActuals(current.id, {
      actualDurationMinutes: Math.round(actualHours * 60),
      productCost: Math.round(productEuros * 100),
      travelCost: Math.round(travelEuros * 100),
      otherDirectCosts: Math.round(otherEuros * 100),
      workerMinutes: Object.fromEntries(Object.entries(actualWorkerHours).map(([id, value]) => [id, Math.round(value * 60)])),
    });
    toast.success(current.status === "completed" ? "Temps et coûts enregistrés" : "Prestation terminée — elle peut maintenant être facturée");
  };

  const linkInvoice = () => {
    const selectedInvoice = eligibleInvoices.find((item) => item.id === invoiceChoice);
    if (!selectedInvoice) return toast.error("Sélectionnez une facture");
    data.linkInvoiceToIntervention(current.id, selectedInvoice.id);
    setPaymentEuros(Math.max(selectedInvoice.totalIncludingTax - data.payments.filter((payment) => payment.invoiceId === selectedInvoice.id).reduce((sum, payment) => sum + payment.amount, 0), 0) / 100);
    toast.success("Facture associée à la prestation");
  };

  const addPayment = () => {
    const amount = paymentEuros > 0 ? paymentEuros : workflow.outstanding / 100;
    if (!invoice || amount <= 0) return toast.error("Saisissez le montant reçu");
    if (Math.round(amount * 100) > workflow.outstanding) return toast.error("Le paiement dépasse le solde restant");
    data.addPayment(invoice.id, Math.round(amount * 100), paymentMethod);
    setPaymentEuros(0);
    toast.success("Paiement enregistré — le chiffre d’affaires encaissé est mis à jour");
  };

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto pb-1">
        <div className="grid min-w-[620px] grid-cols-4 gap-2">
          {workflow.steps.map((step, index) => {
            const Icon = stepIcons[step.id];
            return <div key={step.id} className={`relative rounded-2xl border p-3 ${step.state === "done" ? "border-emerald-200 bg-emerald-50" : step.state === "current" ? "border-brand-200 bg-brand-50 shadow-sm" : "border-zinc-200 bg-zinc-50"}`}><div className="flex items-center gap-2"><span className={`grid size-7 place-items-center rounded-xl ${step.state === "done" ? "bg-emerald-600 text-white" : step.state === "current" ? "bg-brand-500 text-white" : "bg-white text-zinc-400"}`}>{step.state === "done" ? <CheckCircle2 className="size-4" /> : <Icon className="size-3.5" />}</span><span className="text-[10px] font-bold tracking-wider text-zinc-500">0{index + 1}</span></div><p className="mt-3 text-xs font-bold">{step.label}</p><p className="mt-1 text-[10px] text-zinc-500">{step.detail}</p></div>;
          })}
        </div>
      </div>

      {workflow.isCancelled ? <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"><AlertTriangle className="size-5" /> Cette prestation est annulée. Vous pouvez corriger son statut depuis Modifier.</div> : workflow.isComplete ? <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800"><CheckCircle2 className="size-5" /> Parcours terminé : prestation réalisée, facturée et entièrement encaissée.</div> : <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50 to-violet-50 p-4"><div><p className="text-[10px] font-bold tracking-wider text-brand-600 uppercase">Prochaine étape</p><p className="mt-1 text-sm font-bold">{workflow.currentStep === "appointment" ? "Planifier le rendez-vous" : workflow.currentStep === "service" ? current.status === "in_progress" ? "Terminer et saisir les coûts réels" : "Préparer puis réaliser la prestation" : workflow.currentStep === "invoice" ? "Importer ou associer la facture Henrri" : "Enregistrer l’encaissement"}</p></div>{workflow.currentStep === "appointment" && <Link href="/planning"><Button size="sm"><CalendarCheck2 className="size-4" /> Ouvrir le planning</Button></Link>}{workflow.currentStep === "service" && current.status === "scheduled" && <Button size="sm" onClick={() => { data.setInterventionStatus(current.id, "confirmed"); toast.success("Rendez-vous confirmé"); }}><CheckCircle2 className="size-4" /> Confirmer le rendez-vous</Button>}{workflow.currentStep === "service" && current.status === "confirmed" && <Button size="sm" onClick={() => { data.setInterventionStatus(current.id, "in_progress"); toast.success("Prestation démarrée"); }}><Play className="size-4" /> Démarrer</Button>}{workflow.currentStep === "invoice" && <Link href="/documents?tab=imports"><Button size="sm"><FileUp className="size-4" /> Importer une facture</Button></Link>}</div>}

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="flex flex-wrap items-center gap-2"><StatusBadge status={current.status}>{interventionStatusLabels[current.status]}</StatusBadge><Badge>{vehicle?.make} {vehicle?.model}</Badge>{vehicle?.registration && <Badge>{vehicle.registration}</Badge>}</div><h3 className="mt-3 text-base font-bold">Informations du rendez-vous</h3><p className="mt-1 text-xs text-zinc-500">Client, créneau, équipe, contenu et montant prévu.</p></div>
          <Button size="sm" variant="secondary" onClick={() => setEditing((value) => !value)}><Pencil className="size-3.5" /> {editing ? "Fermer l’édition" : "Tout modifier"}</Button>
        </div>

        {editing ? (
          <div className="mt-5 grid gap-5">
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Titre de la prestation"><Input value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="Statut"><Select value={status} onChange={(event) => setStatusDraft(event.target.value as InterventionStatus)}>{Object.entries(interventionStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field></div>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Client"><Select value={clientId} onChange={(event) => chooseClient(event.target.value)}>{data.clients.map((item) => <option key={item.id} value={item.id}>{item.company || `${item.firstName} ${item.lastName}`}</option>)}</Select></Field><Field label="Véhicule"><Select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}><option value="">Sélectionner…</option>{clientVehicles.map((item) => <option key={item.id} value={item.id}>{item.make} {item.model} · {item.registration || "sans immatriculation"}</option>)}</Select></Field></div>
            <div className="grid gap-4 sm:grid-cols-3"><Field label="Date"><Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></Field><Field label="Heure"><Input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></Field><Field label="Durée prévue (h)"><Input min="0.25" max="24" step="0.25" type="number" value={plannedHours} onChange={(event) => setPlannedHours(Number(event.target.value))} /></Field></div>
            <Field label="Adresse"><Input value={address} onChange={(event) => setAddress(event.target.value)} /></Field>
            <Field label="Collaborateurs" hint="Cliquez pour affecter ou retirer une personne."><div className="grid gap-2 sm:grid-cols-2">{data.team.filter((member) => member.active || current.workers.some((worker) => worker.memberId === member.id)).map((member) => { const selected = workerHours[member.id] !== undefined; return <div key={member.id} className={`rounded-xl border p-3 ${selected ? "border-brand-200 bg-brand-50" : "border-zinc-200"}`}><button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => toggleWorker(member.id)}><Avatar label={member.initials} color={member.color} size="sm" /><span className="text-xs font-semibold">{member.firstName} {member.lastName}</span><span className="ml-auto text-[10px] text-zinc-500">{selected ? "Affecté" : "Ajouter"}</span></button>{selected && <Input className="mt-2" aria-label={`Heures prévues pour ${member.firstName}`} min="0" max="24" step="0.25" type="number" value={workerHours[member.id]} onChange={(event) => setWorkerHours((state) => ({ ...state, [member.id]: Number(event.target.value) }))} />}</div>; })}</div></Field>
            <div><div className="flex items-center justify-between"><div><p className="text-sm font-bold">Lignes de prestation</p><p className="mt-1 text-xs text-zinc-500">Chaque ligne et son montant restent modifiables.</p></div><Button size="sm" variant="secondary" onClick={() => setItems((lines) => [...lines, { id: undefined, serviceId: "", label: "Nouvelle prestation", quantity: 1, revenueAllocated: 0, revenueEuros: 0 }])}><Plus className="size-3.5" /> Ajouter</Button></div><div className="mt-3 grid gap-3">{items.map((item, index) => <div key={item.id ?? `line-${index}`} className="grid gap-3 rounded-xl border border-zinc-200 p-3 sm:grid-cols-[1fr_90px_120px_auto]"><Field label="Catalogue"><Select value={item.serviceId} onChange={(event) => chooseService(index, event.target.value)}><option value="">Personnalisée</option>{data.services.filter((service) => !service.archivedAt).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</Select></Field><Field label="Quantité"><Input min="0.1" step="0.1" type="number" value={item.quantity} onChange={(event) => setItems((lines) => lines.map((line, lineIndex) => lineIndex === index ? { ...line, quantity: Number(event.target.value) } : line))} /></Field><Field label="Montant (€)"><Input min="0" step="0.01" type="number" value={item.revenueEuros} onChange={(event) => setItems((lines) => lines.map((line, lineIndex) => lineIndex === index ? { ...line, revenueEuros: Number(event.target.value) } : line))} /></Field><Button className="self-end" aria-label="Supprimer la ligne" size="sm" variant="ghost" disabled={items.length === 1} onClick={() => setItems((lines) => lines.filter((_, lineIndex) => lineIndex !== index))}><Trash2 className="size-4" /></Button><div className="sm:col-span-full"><Field label="Libellé"><Input value={item.label} onChange={(event) => setItems((lines) => lines.map((line, lineIndex) => lineIndex === index ? { ...line, label: event.target.value } : line))} /></Field></div></div>)}</div></div>
            <Field label="Notes internes"><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
            <div className="flex justify-end"><Button onClick={saveDetails}><Save className="size-4" /> Enregistrer toutes les modifications</Button></div>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><p className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase">Client</p><p className="mt-1 text-sm font-semibold">{client?.company || `${client?.firstName} ${client?.lastName}`}</p><div className="mt-2 flex gap-2">{client?.phone && <a className="text-xs font-semibold text-brand-600 hover:underline" href={`tel:${client.phone}`}><Phone className="mr-1 inline size-3" /> Appeler</a>}</div></div>
            <div><p className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase">Créneau</p><p className="mt-1 text-sm font-semibold">{current.startAt ? formatDate(current.startAt, { weekday: "short", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }) : "À planifier"}</p><p className="mt-1 text-xs text-zinc-500">{hours(current.plannedDurationMinutes)} h prévues</p></div>
            <div><p className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase">Équipe</p><div className="mt-2 flex -space-x-1">{current.workers.map((worker) => { const member = data.team.find((item) => item.id === worker.memberId); return <Avatar key={worker.memberId} label={member?.initials ?? "?"} color={member?.color} size="sm" />; })}</div><p className="mt-1 text-xs text-zinc-500">{current.workers.length} personne(s)</p></div>
            <div><p className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase">Montant prévu</p><p className="mt-1 text-lg font-bold text-brand-600">{formatMoney(current.items.reduce((sum, item) => sum + item.revenueAllocated, 0))}</p><p className="mt-1 text-xs text-zinc-500">{current.items.length} ligne(s)</p></div>
            <div className="sm:col-span-2 lg:col-span-4"><p className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase">Adresse</p><a target="_blank" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(current.address)}`} className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline"><MapPin className="size-3.5" /> {current.address || "À renseigner"}</a></div>
          </div>
        )}
      </section>

      {(current.status === "confirmed" || current.status === "in_progress" || current.status === "completed") && <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-bold">Réalisation de la prestation</h3><p className="mt-1 text-xs text-zinc-500">Checklist, temps réellement passé et coûts directs.</p></div>{current.status === "confirmed" && <Button size="sm" onClick={() => data.setInterventionStatus(current.id, "in_progress")}><Play className="size-4" /> Démarrer</Button>}</div><div className="mt-5 rounded-xl bg-zinc-50 p-4"><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold">Checklist opérationnelle</p><p className="text-xs font-bold">{current.checklistDone}/{current.checklistTotal}</p></div><Progress value={current.checklistTotal ? current.checklistDone / current.checklistTotal * 100 : 0} className="mt-3" />{current.checklistTotal > 0 && <Button className="mt-3" size="sm" variant="secondary" disabled={current.checklistDone >= current.checklistTotal} onClick={() => data.incrementChecklist(current.id)}><CheckCircle2 className="size-3.5" /> Étape suivante</Button>}{current.checklistTotal === 0 && <p className="mt-2 text-[10px] text-zinc-500">Aucune checklist n’est associée à cette prestation.</p>}</div>{(current.status === "in_progress" || current.status === "completed") && <div className="mt-5"><div className="grid gap-4 sm:grid-cols-2"><Field label="Durée réelle (h)"><Input min="0" step="0.25" type="number" value={actualHours} onChange={(event) => setActualHours(Number(event.target.value))} /></Field>{current.workers.map((worker) => { const member = data.team.find((item) => item.id === worker.memberId); return <Field key={worker.memberId} label={`Temps de ${member?.firstName ?? "collaborateur"} (h)`}><Input min="0" step="0.25" type="number" value={actualWorkerHours[worker.memberId] ?? 0} onChange={(event) => setActualWorkerHours((state) => ({ ...state, [worker.memberId]: Number(event.target.value) }))} /></Field>; })}<Field label="Produits (€)"><Input min="0" step="0.01" type="number" value={productEuros} onChange={(event) => setProductEuros(Number(event.target.value))} /></Field><Field label="Déplacement (€)"><Input min="0" step="0.01" type="number" value={travelEuros} onChange={(event) => setTravelEuros(Number(event.target.value))} /></Field><Field label="Autres coûts (€)"><Input min="0" step="0.01" type="number" value={otherEuros} onChange={(event) => setOtherEuros(Number(event.target.value))} /></Field></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="flex gap-4 text-xs"><span>Marge <strong>{formatMoney(margin)}</strong></span><span>Marge/h <strong>{hourly === null ? "—" : `${formatMoney(hourly)}/h`}</strong></span></div><Button onClick={finishService}>{current.status === "completed" ? <Save className="size-4" /> : <Square className="size-4" />} {current.status === "completed" ? "Mettre à jour les temps et coûts" : "Terminer la prestation"}</Button></div></div>}</section>}

      <section className={`rounded-2xl border p-4 sm:p-5 ${current.status === "completed" || invoice ? "border-violet-200 bg-violet-50/40" : "border-zinc-200 bg-zinc-50"}`}>
        <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-violet-100 text-violet-700"><ReceiptText className="size-5" /></span><div><h3 className="text-base font-bold">Facture & encaissement</h3><p className="mt-1 text-xs text-zinc-500">Henrri reste la facture officielle ; ADetailing suit son association et ses paiements.</p></div></div>
        {current.status !== "completed" && !invoice ? <p className="mt-5 rounded-xl border border-dashed border-zinc-300 p-5 text-center text-xs text-zinc-500">Cette zone sera disponible dès que la prestation sera terminée.</p> : !invoice ? <div className="mt-5 grid gap-4"><div className="grid gap-3 sm:grid-cols-[1fr_auto]"><Field label="Facture Henrri du client"><Select value={invoiceChoice} onChange={(event) => setInvoiceChoice(event.target.value)}><option value="">Sélectionner une facture importée…</option>{eligibleInvoices.map((item) => <option key={item.id} value={item.id}>{item.number} · {formatMoney(item.totalIncludingTax)} · {formatDate(item.issuedAt)}</option>)}</Select></Field><Button className="self-end" disabled={!invoiceChoice} onClick={linkInvoice}><ReceiptText className="size-4" /> Associer</Button></div><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-4"><p className="text-xs text-zinc-600">La facture n’est pas encore dans ADetailing ? Importez son PDF puis revenez l’associer ici.</p><Link href="/documents?tab=imports"><Button size="sm" variant="secondary"><FileUp className="size-3.5" /> Importer le PDF</Button></Link></div></div> : <div className="mt-5 grid gap-4"><div className="grid gap-3 rounded-2xl bg-white p-4 sm:grid-cols-4"><div><p className="text-[10px] font-bold text-zinc-500 uppercase">Facture</p><p className="mt-1 text-sm font-bold">{invoice.number}</p></div><div><p className="text-[10px] font-bold text-zinc-500 uppercase">Total TTC</p><p className="mt-1 text-sm font-bold">{formatMoney(invoice.totalIncludingTax)}</p></div><div><p className="text-[10px] font-bold text-zinc-500 uppercase">Encaissé</p><p className="mt-1 text-sm font-bold text-emerald-700">{formatMoney(workflow.paidAmount)}</p></div><div><p className="text-[10px] font-bold text-zinc-500 uppercase">Reste</p><p className="mt-1 text-sm font-bold text-brand-700">{formatMoney(workflow.outstanding)}</p></div><div className="sm:col-span-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3"><StatusBadge status={paymentStatusForInvoice(invoice, data.payments)}>{paymentStatusLabels[paymentStatusForInvoice(invoice, data.payments)]}</StatusBadge><button className="text-[10px] font-semibold text-zinc-500 hover:text-red-600" onClick={() => { data.linkInvoiceToIntervention(current.id, undefined); setInvoiceChoice(""); toast.info("Facture dissociée"); }}>Changer de facture</button></div></div>{workflow.outstanding > 0 && <div className="grid gap-3 rounded-2xl border border-emerald-200 bg-white p-4 sm:grid-cols-[1fr_1fr_auto]"><Field label="Montant reçu (€)"><Input min="0.01" max={workflow.outstanding / 100} step="0.01" type="number" value={paymentEuros || workflow.outstanding / 100} onChange={(event) => setPaymentEuros(Number(event.target.value))} /></Field><Field label="Moyen de paiement"><Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option>Carte</option><option>Virement</option><option>Espèces</option><option>Chèque</option></Select></Field><Button className="self-end" onClick={addPayment}><CircleDollarSign className="size-4" /> Encaisser</Button></div>}{data.payments.some((payment) => payment.invoiceId === invoice.id) && <div><p className="mb-2 text-xs font-bold">Historique des paiements</p><div className="grid gap-2">{data.payments.filter((payment) => payment.invoiceId === invoice.id).map((payment) => <div key={payment.id} className="flex items-center justify-between rounded-xl bg-white px-4 py-3 text-xs"><span>{formatDate(payment.paidAt)} · {payment.method}</span><strong>{formatMoney(payment.amount)}</strong></div>)}</div></div>}</div>}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-bold"><Camera className="size-4 text-sky-600" /> Photos de la prestation</p><p className="mt-1 text-xs text-zinc-500">Ajoutez les photos avant et après depuis un ordinateur ou un téléphone.</p></div><Button size="sm" variant="secondary" onClick={() => photoInputRef.current?.click()}><Plus className="size-3.5" /> Ajouter des photos</Button></div><input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { const next = Array.from(event.target.files ?? []).map((file) => ({ name: file.name, size: file.size })); if (next.length) { setPhotos((value) => [...value, ...next]); toast.success(`${next.length} photo(s) sélectionnée(s)`); } event.target.value = ""; }} />{photos.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{photos.map((photo, index) => <Badge key={`${photo.name}-${index}`}>{photo.name} · {Math.max(1, Math.round(photo.size / 1024))} Ko</Badge>)}</div>}</section>

      <div className="flex flex-wrap gap-2">{client?.phone && <a href={`tel:${client.phone}`}><Button variant="secondary"><Phone className="size-4" /> Appeler</Button></a>}{current.address && <a target="_blank" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(current.address)}`}><Button variant="secondary"><MapPin className="size-4" /> Itinéraire <ExternalLink className="size-3" /></Button></a>}<Link href="/planning"><Button variant="ghost"><Clock3 className="size-4" /> Voir dans le planning</Button></Link></div>
    </div>
  );
}
