"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarPlus2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useDemoStore } from "@/lib/demo/store";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { Field, Input, Select } from "./ui/field";
import { Modal } from "./ui/modal";

type AddKind = "appointment" | "lead" | "client" | "expense";

const leadSchema = z.object({
  prospectName: z.string().min(2, "Nom requis"),
  phone: z.string().min(6, "Téléphone requis"),
  email: z.email("E-mail invalide").or(z.literal("")),
  vehicleLabel: z.string().min(2, "Véhicule requis"),
  serviceLabel: z.string().min(2, "Prestation requise"),
  estimatedAmountEuros: z.number().min(0),
  source: z.string().min(1),
  ownerId: z.string().min(1),
});

const clientSchema = z.object({
  kind: z.enum(["individual", "business"]),
  company: z.string().optional(),
  firstName: z.string().min(2, "Prénom requis"),
  lastName: z.string().min(2, "Nom requis"),
  email: z.email("E-mail invalide").or(z.literal("")),
  phone: z.string().min(6, "Téléphone requis"),
  city: z.string().min(2, "Ville requise"),
  source: z.string().min(1),
  vehicleMake: z.string().optional(),
  vehicleModel: z.string().optional(),
  registration: z.string().optional(),
  vehicleFormat: z.string().optional(),
});

const expenseSchema = z.object({
  date: z.string().min(1),
  family: z.enum(["fixed", "variable", "investment", "personal"]),
  category: z.string().min(2, "Catégorie requise"),
  supplier: z.string().min(2, "Fournisseur requis"),
  description: z.string().min(2, "Description requise"),
  amountEuros: z.number().positive("Montant requis"),
  vatRate: z.number().min(0).max(100),
  paid: z.boolean(),
});

function LeadForm({ close }: { close: () => void }) {
  const addLead = useDemoStore((state) => state.addLead);
  const { mode, createRecord } = useWorkspace();
  const sources = useDemoStore((state) => state.settings.leadSources);
  const team = useDemoStore((state) => state.team);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof leadSchema>>({
    resolver: zodResolver(leadSchema),
    defaultValues: { email: "", estimatedAmountEuros: 0, source: sources[0], ownerId: team[0]?.id },
  });
  return (
    <form className="grid gap-4" onSubmit={handleSubmit(async (values) => {
      try {
        const input = { ...values, estimatedAmount: Math.round(values.estimatedAmountEuros * 100) };
        if (mode === "supabase") await createRecord({ kind: "lead", ...input }); else addLead(input);
        toast.success("Demande ajoutée au pipeline");
        close();
      } catch (error) { toast.error(error instanceof Error ? error.message : "Enregistrement impossible"); }
    })}>
      <Field label="Nom du prospect" error={errors.prospectName?.message}><Input autoFocus {...register("prospectName")} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Téléphone" error={errors.phone?.message}><Input inputMode="tel" {...register("phone")} /></Field>
        <Field label="E-mail" error={errors.email?.message}><Input type="email" {...register("email")} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Véhicule" error={errors.vehicleLabel?.message}><Input placeholder="Audi A4 Break" {...register("vehicleLabel")} /></Field>
        <Field label="Prestation envisagée" error={errors.serviceLabel?.message}><Input placeholder="Formule 2" {...register("serviceLabel")} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Estimation (€)"><Input type="number" step="0.01" {...register("estimatedAmountEuros", { valueAsNumber: true })} /></Field>
        <Field label="Source"><Select {...register("source")}>{sources.map((source) => <option key={source}>{source}</option>)}</Select></Field>
        <Field label="Responsable"><Select {...register("ownerId")}>{team.map((member) => <option key={member.id} value={member.id}>{member.firstName}</option>)}</Select></Field>
      </div>
      <Button type="submit" className="mt-2" disabled={isSubmitting}>{isSubmitting ? "Enregistrement…" : "Créer la demande"}</Button>
    </form>
  );
}

function ClientForm({ close }: { close: () => void }) {
  const addClient = useDemoStore((state) => state.addClient);
  const { mode, createRecord } = useWorkspace();
  const settings = useDemoStore((state) => state.settings);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof clientSchema>>({
    resolver: zodResolver(clientSchema),
    defaultValues: { kind: "individual", source: settings.leadSources[0], vehicleFormat: settings.vehicleFormats[0], email: "" },
  });
  return (
    <form className="grid gap-4" onSubmit={handleSubmit(async (values) => {
      try {
        const vehicle = values.vehicleMake ? { make: values.vehicleMake, model: values.vehicleModel ?? "", registration: values.registration ?? "", format: values.vehicleFormat ?? "Autre" } : undefined;
        const input = { ...values, vehicle };
        if (mode === "supabase") await createRecord({ kind: "client", clientKind: values.kind, company: values.company, firstName: values.firstName, lastName: values.lastName, email: values.email, phone: values.phone, city: values.city, source: values.source, vehicle }); else addClient(input);
        toast.success("Client enregistré");
        close();
      } catch (error) { toast.error(error instanceof Error ? error.message : "Enregistrement impossible"); }
    })}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type"><Select {...register("kind")}><option value="individual">Particulier</option><option value="business">Professionnel</option></Select></Field>
        <Field label="Société"><Input {...register("company")} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prénom" error={errors.firstName?.message}><Input autoFocus {...register("firstName")} /></Field>
        <Field label="Nom" error={errors.lastName?.message}><Input {...register("lastName")} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Téléphone" error={errors.phone?.message}><Input {...register("phone")} /></Field>
        <Field label="E-mail" error={errors.email?.message}><Input type="email" {...register("email")} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ville"><Input {...register("city")} /></Field>
        <Field label="Source"><Select {...register("source")}>{settings.leadSources.map((source) => <option key={source}>{source}</option>)}</Select></Field>
      </div>
      <div className="mt-2 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
        <p className="mb-4 text-sm font-semibold">Premier véhicule <span className="font-normal text-zinc-500">· optionnel</span></p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Marque"><Input {...register("vehicleMake")} /></Field>
          <Field label="Modèle"><Input {...register("vehicleModel")} /></Field>
          <Field label="Immatriculation"><Input {...register("registration")} /></Field>
          <Field label="Format"><Select {...register("vehicleFormat")}>{settings.vehicleFormats.map((format) => <option key={format}>{format}</option>)}</Select></Field>
        </div>
      </div>
      <Button type="submit" className="mt-2" disabled={isSubmitting}>{isSubmitting ? "Enregistrement…" : "Créer le client"}</Button>
    </form>
  );
}

function AppointmentForm({ close }: { close: () => void }) {
  const data = useDemoStore();
  const addAppointment = useDemoStore((state) => state.addAppointment);
  const { mode, createRecord } = useWorkspace();
  const router = useRouter();
  const activeTeam = data.team.filter((member) => member.active);
  const activeServices = data.services.filter((service) => service.active && !service.archivedAt);
  const initialClient = data.clients[0];
  const initialVehicle = data.vehicles.find((vehicle) => vehicle.clientId === initialClient?.id);
  const initialService = activeServices[0];
  const [clientId, setClientId] = useState(initialClient?.id ?? "");
  const [vehicleId, setVehicleId] = useState(initialVehicle?.id ?? "");
  const [serviceId, setServiceId] = useState(initialService?.id ?? "");
  const [date, setDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [time, setTime] = useState("09:00");
  const [durationHours, setDurationHours] = useState((initialService?.targetDurationMinutes ?? 120) / 60);
  const [priceEuros, setPriceEuros] = useState((initialService?.prices[0]?.amount ?? 0) / 100);
  const [address, setAddress] = useState(initialClient ? [initialClient.address, initialClient.postalCode, initialClient.city].filter(Boolean).join(" ") : "");
  const [workerIds, setWorkerIds] = useState<string[]>(activeTeam[0]?.id ? [activeTeam[0].id] : []);
  const [submitting, setSubmitting] = useState(false);
  const clientVehicles = data.vehicles.filter((vehicle) => vehicle.clientId === clientId);

  const priceFor = (nextServiceId: string, nextVehicleId: string) => {
    const service = activeServices.find((item) => item.id === nextServiceId);
    const vehicle = data.vehicles.find((item) => item.id === nextVehicleId);
    return (service?.prices.find((item) => item.vehicleFormat === vehicle?.format)?.amount ?? service?.prices[0]?.amount ?? 0) / 100;
  };

  const chooseClient = (nextClientId: string) => {
    const client = data.clients.find((item) => item.id === nextClientId);
    const vehicle = data.vehicles.find((item) => item.clientId === nextClientId);
    setClientId(nextClientId);
    setVehicleId(vehicle?.id ?? "");
    setPriceEuros(priceFor(serviceId, vehicle?.id ?? ""));
    setAddress(client ? [client.address, client.postalCode, client.city].filter(Boolean).join(" ") : "");
  };

  const chooseVehicle = (nextVehicleId: string) => {
    setVehicleId(nextVehicleId);
    setPriceEuros(priceFor(serviceId, nextVehicleId));
  };

  const chooseService = (nextServiceId: string) => {
    const service = activeServices.find((item) => item.id === nextServiceId);
    setServiceId(nextServiceId);
    setDurationHours((service?.targetDurationMinutes ?? 120) / 60);
    setPriceEuros(priceFor(nextServiceId, vehicleId));
  };

  const submit = async () => {
    const service = activeServices.find((item) => item.id === serviceId);
    if (!clientId) return toast.error("Sélectionnez un client");
    if (!vehicleId) return toast.error("Ajoutez ou sélectionnez un véhicule pour ce client");
    if (!service) return toast.error("Sélectionnez une prestation");
    if (workerIds.length === 0) return toast.error("Affectez au moins un collaborateur");
    if (!date || !time || !Number.isFinite(durationHours) || durationHours <= 0) return toast.error("Le créneau est incomplet");
    const startAt = new Date(`${date}T${time}`).toISOString();
    const input = { clientId, vehicleId, serviceId, title: service.name, startAt, plannedDurationMinutes: Math.round(durationHours * 60), workerIds, address, revenueAllocated: Math.round(priceEuros * 100) };
    setSubmitting(true);
    try {
      const id = mode === "supabase" ? await createRecord({ kind: "appointment", ...input }) : addAppointment(input);
      toast.success("Rendez-vous créé et ajouté au planning");
      close();
      router.push(`/prestations?intervention=${id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Création du rendez-vous impossible");
    } finally {
      setSubmitting(false);
    }
  };

  if (data.clients.length === 0) return <div className="rounded-2xl border border-dashed border-zinc-200 p-8 text-center"><p className="text-sm font-bold">Créez d’abord un client</p><p className="mt-2 text-xs text-zinc-500">Un rendez-vous doit être rattaché à un client et à son véhicule.</p></div>;

  return (
    <div className="grid gap-4">
      <div className="rounded-2xl border border-brand-200 bg-brand-50/70 p-4"><p className="flex items-center gap-2 text-sm font-bold text-brand-700"><CalendarPlus2 className="size-4" /> Nouveau rendez-vous</p><p className="mt-1 text-xs text-brand-600">Les informations pourront être modifiées ensuite depuis la fiche prestation.</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client"><Select autoFocus value={clientId} onChange={(event) => chooseClient(event.target.value)}>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.company || `${client.firstName} ${client.lastName}`}</option>)}</Select></Field>
        <Field label="Véhicule"><Select value={vehicleId} onChange={(event) => chooseVehicle(event.target.value)}><option value="">Sélectionner…</option>{clientVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.make} {vehicle.model} · {vehicle.registration || "sans immatriculation"}</option>)}</Select></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1.35fr_.65fr]">
        <Field label="Prestation"><Select value={serviceId} onChange={(event) => chooseService(event.target.value)}><option value="">Sélectionner…</option>{activeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</Select></Field>
        <Field label="Montant prévu (€)"><Input min="0" step="0.01" type="number" value={priceEuros} onChange={(event) => setPriceEuros(Number(event.target.value))} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Date"><Input min={new Date().toISOString().slice(0, 10)} type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="Heure"><Input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></Field>
        <Field label="Durée prévue (h)"><Input min="0.25" step="0.25" type="number" value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value))} /></Field>
      </div>
      <Field label="Adresse de la prestation"><Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Adresse, code postal, ville" /></Field>
      <Field label="Collaborateurs" hint="Sélectionnez toutes les personnes prévues sur la prestation.">
        <div className="flex flex-wrap gap-2">{activeTeam.map((member) => { const selected = workerIds.includes(member.id); return <button key={member.id} type="button" aria-pressed={selected} onClick={() => setWorkerIds((ids) => selected ? ids.filter((id) => id !== member.id) : [...ids, member.id])} className={`focus-ring rounded-xl border px-3 py-2 text-xs font-semibold transition ${selected ? "border-brand-300 bg-brand-50 text-brand-700" : "border-zinc-200 bg-white text-zinc-500 hover:border-brand-200"}`}>{member.firstName} {member.lastName}</button>; })}</div>
      </Field>
      <Button onClick={() => void submit()} disabled={submitting}><CalendarPlus2 className="size-4" /> {submitting ? "Création…" : "Créer et ouvrir la prestation"}</Button>
    </div>
  );
}

function ExpenseForm({ close }: { close: () => void }) {
  const addExpense = useDemoStore((state) => state.addExpense);
  const { mode, createRecord } = useWorkspace();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof expenseSchema>>({
    resolver: zodResolver(expenseSchema),
    defaultValues: { date: new Date().toISOString().slice(0, 10), family: "variable", vatRate: 20, paid: true },
  });
  return (
    <form className="grid gap-4" onSubmit={handleSubmit(async (values) => {
      try {
        const input = { date: new Date(`${values.date}T12:00:00`).toISOString(), family: values.family, category: values.category, supplier: values.supplier, description: values.description, amountIncludingTax: Math.round(values.amountEuros * 100), vatRateBasisPoints: Math.round(values.vatRate * 100), paid: values.paid };
        if (mode === "supabase") await createRecord({ ...input, kind: "expense", date: values.date }); else addExpense(input);
        toast.success("Dépense enregistrée");
        close();
      } catch (error) { toast.error(error instanceof Error ? error.message : "Enregistrement impossible"); }
    })}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date"><Input type="date" {...register("date")} /></Field>
        <Field label="Famille"><Select {...register("family")}><option value="fixed">Fixe</option><option value="variable">Variable</option><option value="investment">Investissement</option><option value="personal">Personnel</option></Select></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Catégorie" error={errors.category?.message}><Input {...register("category")} /></Field>
        <Field label="Fournisseur" error={errors.supplier?.message}><Input {...register("supplier")} /></Field>
      </div>
      <Field label="Description" error={errors.description?.message}><Input {...register("description")} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Montant TTC (€)" error={errors.amountEuros?.message}><Input type="number" step="0.01" {...register("amountEuros", { valueAsNumber: true })} /></Field>
        <Field label="TVA (%)"><Input type="number" step="0.1" {...register("vatRate", { valueAsNumber: true })} /></Field>
      </div>
      <label className="flex items-center gap-3 rounded-xl border border-white/[0.07] p-3 text-sm text-zinc-300"><input type="checkbox" className="accent-brand-500" {...register("paid")} /> Dépense déjà payée</label>
      <Button type="submit" className="mt-2" disabled={isSubmitting}>{isSubmitting ? "Enregistrement…" : "Enregistrer la dépense"}</Button>
    </form>
  );
}

export function GlobalAdd() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AddKind>("appointment");
  const close = () => setOpen(false);
  useEffect(() => {
    const openGlobalAdd = (event: Event) => {
      const requestedKind = (event as CustomEvent<AddKind>).detail;
      if (requestedKind) setKind(requestedKind);
      setOpen(true);
    };
    window.addEventListener("adetailing:open-add", openGlobalAdd);
    return () => window.removeEventListener("adetailing:open-add", openGlobalAdd);
  }, []);
  return (
    <>
      <Button onClick={() => setOpen(true)} aria-label="Ajouter"><Plus className="size-4" /> <span className="hidden sm:inline">Ajouter</span></Button>
      <Modal open={open} onClose={close} title="Ajouter" description="Une saisie courte, le reste pourra être complété plus tard.">
        <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-white/[0.035] p-1 sm:grid-cols-4">
          {([['appointment', 'Rendez-vous'], ['lead', 'Demande'], ['client', 'Client'], ['expense', 'Dépense']] as const).map(([value, label]) => (
            <button key={value} data-active={kind === value} className={`focus-ring tab-interactive rounded-lg px-3 py-2 text-xs font-semibold ${kind === value ? 'bg-white/10 text-white' : 'text-zinc-500'}`} onClick={() => setKind(value)}>{label}</button>
          ))}
        </div>
        {kind === "appointment" && <AppointmentForm close={close} />}
        {kind === "lead" && <LeadForm close={close} />}
        {kind === "client" && <ClientForm close={close} />}
        {kind === "expense" && <ExpenseForm close={close} />}
      </Modal>
    </>
  );
}
