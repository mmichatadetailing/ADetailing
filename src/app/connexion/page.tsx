"use client";

import { ArrowRight, Building2, Database, KeyRound, LockKeyhole, UserPlus } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { BrandLogo } from "@/components/brand-logo";

type AuthMode = "login" | "signup" | "reset";
type InvitationContext = { organization_name: string; invited_email: string; invited_role: "partner" | "employee"; invited_first_name: string; invited_last_name: string; expires_at: string; invitation_status: "pending" | "accepted" | "expired" | "revoked" };

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [organizationName, setOrganizationName] = useState("ADetailing");
  const [city, setCity] = useState("Orange");
  const [loading, setLoading] = useState(false);
  const [invitationToken, setInvitationToken] = useState("");
  const [invitation, setInvitation] = useState<InvitationContext | null>(null);
  const [invitationError, setInvitationError] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const token = new URLSearchParams(location.search).get("invitation")?.trim() ?? "";
    if (!token) return;
    const inspectInvitation = async () => {
      setInvitationToken(token);
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("get_organization_invitation", { invitation_token: token });
      const context = Array.isArray(data) ? data[0] as InvitationContext | undefined : undefined;
      if (error || !context) return setInvitationError("Cette invitation est introuvable.");
      if (context.invitation_status !== "pending" && context.invitation_status !== "accepted") return setInvitationError(context.invitation_status === "expired" ? "Cette invitation a expiré. Demandez-en une nouvelle." : "Cette invitation a été révoquée.");
      setInvitation(context);
      setEmail(context.invited_email);
      setFirstName(context.invited_first_name);
      setLastName(context.invited_last_name);
      setOrganizationName(context.organization_name);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error: acceptError } = await supabase.rpc("accept_organization_invitation", { invitation_token: token });
        if (acceptError) return setInvitationError(acceptError.message);
        location.assign("/dashboard");
      }
    };
    void inspectInvitation();
  }, []);

  const submit = async () => {
    if (!isSupabaseConfigured || loading) return;
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        if (invitationToken) {
          const { error: invitationAcceptError } = await supabase.rpc("accept_organization_invitation", { invitation_token: invitationToken });
          if (invitationAcceptError) throw invitationAcceptError;
        }
        location.assign("/dashboard");
        return;
      }
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/auth/callback?next=/compte` });
        if (error) throw error;
        toast.success("Un lien de réinitialisation vient de vous être envoyé.");
        setMode("login");
        return;
      }
      if (password.length < 8) throw new Error("Le mot de passe doit contenir au moins 8 caractères.");
      if (firstName.trim().length < 2 || lastName.trim().length < 2) throw new Error("Votre prénom et votre nom sont requis.");
      if (!invitationToken && organizationName.trim().length < 2) throw new Error("Le nom de l’entreprise est requis.");
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(), password,
        options: { emailRedirectTo: `${location.origin}/auth/callback`, data: { first_name: firstName.trim(), last_name: lastName.trim(), organization_name: organizationName.trim(), city: city.trim(), invitation_token: invitationToken || undefined } },
      });
      if (error) throw error;
      if (data.session) location.assign("/dashboard");
      else {
        toast.success("Compte créé. Confirmez votre adresse depuis l’e-mail reçu.");
        setMode("login");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "L’opération a échoué.");
    } finally { setLoading(false); }
  };

  return (
    <main className="min-h-screen lg:grid lg:grid-cols-[1fr_1fr]">
      <section className="relative hidden min-h-screen overflow-hidden bg-[#111113] lg:block" aria-label="ADetailing, le sens du détail">
        <Image src="/brand/detailing.webp" alt="" fill priority sizes="50vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/20 to-black/85" />
        <div className="relative flex h-full min-h-screen flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center justify-between gap-6"><BrandLogo inverted className="w-40" priority /><span className="rounded-full border border-white/30 px-4 py-2 text-[9px] font-medium tracking-[.2em] text-white uppercase">Espace interne</span></div>
          <div className="max-w-lg pb-10 text-white">
            <p className="mb-5 text-[10px] font-medium tracking-[.25em] text-white/70 uppercase">ADetailing · Orange</p>
            <p className="text-4xl font-medium leading-tight tracking-[-.04em] xl:text-5xl">Le sens du détail.<br />À chaque étape.</p>
            <p className="mt-6 max-w-sm text-sm leading-7 text-white/75">Un espace commun pour organiser les prestations, accompagner vos clients et faire avancer l’entreprise.</p>
          </div>
          <p className="text-[10px] tracking-[.12em] text-white/60 uppercase">Organisation · Précision · Excellence</p>
        </div>
      </section>
      <section className="flex min-h-screen items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-lg">
          <div className="mb-8">
            <BrandLogo className="mb-8 w-36 lg:hidden" priority />
            <p className="brand-eyebrow mb-4">Votre espace de travail</p>
            <h1 className="text-3xl font-semibold tracking-[-.04em]">ADetailing Pilotage</h1>
            <p className="mt-3 text-sm leading-6 text-zinc-500">{invitation ? `Rejoignez l’équipe ${invitation.organization_name}.` : "Vos clients, vos opérations et vos chiffres au même endroit."}</p>
          </div>
          <Card><CardContent className="p-6 sm:p-7">{isSupabaseConfigured ? <>{invitationError && <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">{invitationError}</div>}{invitation && <div className="mb-5 rounded-2xl border border-brand-200 bg-brand-50 p-4"><p className="text-sm font-bold text-brand-700">Invitation · {invitation.organization_name}</p><p className="mt-1 text-xs text-brand-600">Connectez-vous ou créez votre compte avec {invitation.invited_email}.</p></div>}<div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-zinc-100 p-1"><button type="button" className={`rounded-xl px-3 py-2.5 text-xs font-bold transition ${mode === "login" || mode === "reset" ? "bg-white text-brand-600 shadow-sm" : "text-zinc-500"}`} onClick={() => setMode("login")}><LockKeyhole className="mr-1.5 inline size-3.5" /> Connexion</button><button type="button" className={`rounded-xl px-3 py-2.5 text-xs font-bold transition ${mode === "signup" ? "bg-white text-brand-600 shadow-sm" : "text-zinc-500"}`} onClick={() => setMode("signup")}><UserPlus className="mr-1.5 inline size-3.5" /> Créer un compte</button></div><form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="grid gap-4">{mode === "signup" && <><div className="grid gap-4 sm:grid-cols-2"><Field label="Prénom"><Input autoFocus value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" required /></Field><Field label="Nom"><Input value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" required /></Field></div>{!invitation && <div className="grid gap-4 sm:grid-cols-2"><Field label="Entreprise"><Input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required /></Field><Field label="Ville"><Input value={city} onChange={(event) => setCity(event.target.value)} /></Field></div>}</>}<Field label="E-mail"><Input autoFocus={mode !== "signup"} type="email" value={email} readOnly={Boolean(invitation)} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></Field>{mode !== "reset" && <Field label="Mot de passe" hint={mode === "signup" ? "8 caractères minimum" : undefined}><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} required /></Field>}<Button type="submit" disabled={loading || Boolean(invitationError)}>{mode === "login" ? <LockKeyhole className="size-4" /> : mode === "signup" ? <Building2 className="size-4" /> : <KeyRound className="size-4" />} {loading ? "Patientez…" : mode === "login" ? invitation ? "Se connecter et rejoindre" : "Se connecter" : mode === "signup" ? invitation ? "Créer mon compte et rejoindre" : "Créer mon espace" : "Envoyer le lien"}</Button>{mode === "login" && !invitation && <button type="button" onClick={() => setMode("reset")} className="text-xs font-semibold text-zinc-500 transition hover:text-brand-600">Mot de passe oublié ?</button>}{mode === "reset" && <button type="button" onClick={() => setMode("login")} className="text-xs font-semibold text-zinc-500 transition hover:text-brand-600">Retour à la connexion</button>}</form></> : <div className="text-center"><span className="mx-auto grid size-11 place-items-center rounded-2xl bg-brand-50 text-brand-600"><Database className="size-5" /></span><h2 className="mt-4 text-sm font-bold">Mode démonstration disponible</h2><p className="mt-2 text-xs leading-5 text-zinc-500">Ajoutez les variables Supabase dans <code>.env.local</code> pour activer les comptes et les données réelles.</p><Link href="/dashboard" className={`${buttonVariants()} mt-5 w-full`}>Ouvrir la démonstration <ArrowRight className="size-4" /></Link></div>}</CardContent></Card>
          <p className="mt-6 flex items-center justify-center gap-2 text-[11px] text-zinc-500"><LockKeyhole className="size-3.5" /> Un espace réservé à votre équipe</p>
        </div>
      </section>
    </main>
  );
}
