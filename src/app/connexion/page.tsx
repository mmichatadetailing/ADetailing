"use client";

import { ArrowRight, Building2, Database, KeyRound, LockKeyhole, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type AuthMode = "login" | "signup" | "reset";
type InvitationContext = { organization_name: string; invited_email: string; invited_role: "partner" | "employee"; expires_at: string; invitation_status: "pending" | "accepted" | "expired" | "revoked" };

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

  return <main className="relative grid min-h-screen place-items-center overflow-hidden p-5"><div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_15%_20%,rgba(253,186,116,.26),transparent_30%),radial-gradient(circle_at_85%_15%,rgba(196,181,253,.3),transparent_28%),radial-gradient(circle_at_70%_90%,rgba(94,234,212,.2),transparent_32%)]" /><div className="w-full max-w-lg"><div className="mb-7 text-center"><span className="mx-auto grid size-14 rotate-[-3deg] place-items-center rounded-[20px] bg-gradient-to-br from-brand-500 via-orange-400 to-fuchsia-400 text-lg font-black text-on-accent shadow-[0_16px_45px_rgba(249,115,79,.3)]">AD</span><h1 className="mt-5 text-3xl font-extrabold tracking-tight">ADetailing Pilotage</h1><p className="mt-2 text-sm text-zinc-500">{invitation ? `Rejoignez l’équipe ${invitation.organization_name}.` : "Vos clients, vos opérations et vos chiffres au même endroit."}</p></div><Card><CardContent className="p-6 sm:p-7">{isSupabaseConfigured ? <>{invitationError && <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">{invitationError}</div>}{invitation && <div className="mb-5 rounded-2xl border border-violet-200 bg-violet-50 p-4"><p className="text-sm font-bold text-violet-800">Invitation · {invitation.organization_name}</p><p className="mt-1 text-xs text-violet-700">Connectez-vous ou créez votre compte avec {invitation.invited_email}.</p></div>}<div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-zinc-100 p-1"><button type="button" className={`rounded-xl px-3 py-2.5 text-xs font-bold transition ${mode === "login" || mode === "reset" ? "bg-white text-brand-600 shadow-sm" : "text-zinc-500"}`} onClick={() => setMode("login")}><LockKeyhole className="mr-1.5 inline size-3.5" /> Connexion</button><button type="button" className={`rounded-xl px-3 py-2.5 text-xs font-bold transition ${mode === "signup" ? "bg-white text-brand-600 shadow-sm" : "text-zinc-500"}`} onClick={() => setMode("signup")}><UserPlus className="mr-1.5 inline size-3.5" /> Créer un compte</button></div><form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="grid gap-4">{mode === "signup" && <><div className="grid gap-4 sm:grid-cols-2"><Field label="Prénom"><Input autoFocus value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" required /></Field><Field label="Nom"><Input value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" required /></Field></div>{!invitation && <div className="grid gap-4 sm:grid-cols-2"><Field label="Entreprise"><Input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required /></Field><Field label="Ville"><Input value={city} onChange={(event) => setCity(event.target.value)} /></Field></div>}</>}<Field label="E-mail"><Input autoFocus={mode !== "signup"} type="email" value={email} readOnly={Boolean(invitation)} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></Field>{mode !== "reset" && <Field label="Mot de passe" hint={mode === "signup" ? "8 caractères minimum" : undefined}><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} required /></Field>}<Button type="submit" disabled={loading || Boolean(invitationError)}>{mode === "login" ? <LockKeyhole className="size-4" /> : mode === "signup" ? <Building2 className="size-4" /> : <KeyRound className="size-4" />} {loading ? "Patientez…" : mode === "login" ? invitation ? "Se connecter et rejoindre" : "Se connecter" : mode === "signup" ? invitation ? "Créer mon compte et rejoindre" : "Créer mon espace" : "Envoyer le lien"}</Button>{mode === "login" && !invitation && <button type="button" onClick={() => setMode("reset")} className="text-xs font-semibold text-zinc-500 transition hover:text-brand-600">Mot de passe oublié ?</button>}{mode === "reset" && <button type="button" onClick={() => setMode("login")} className="text-xs font-semibold text-zinc-500 transition hover:text-brand-600">Retour à la connexion</button>}</form></> : <div className="text-center"><span className="mx-auto grid size-11 place-items-center rounded-2xl bg-sky-100 text-sky-600"><Database className="size-5" /></span><h2 className="mt-4 text-sm font-bold">Mode démonstration disponible</h2><p className="mt-2 text-xs leading-5 text-zinc-500">Ajoutez les variables Supabase dans <code>.env.local</code> pour activer les comptes et les données réelles.</p><Link href="/dashboard" className="mt-5 block"><Button className="w-full">Ouvrir la démonstration <ArrowRight className="size-4" /></Button></Link></div>}</CardContent></Card></div></main>;
}
