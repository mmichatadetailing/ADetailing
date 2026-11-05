"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div role="alert" className="mx-auto max-w-lg rounded-3xl border border-orange-200 bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-bold">Cette page n’a pas pu s’afficher</h1><p className="mt-3 text-sm text-zinc-500">Vos données enregistrées sont conservées. Réessayez ou revenez à l’accueil.</p><div className="mt-6 flex flex-wrap justify-center gap-3"><Button onClick={reset}>Réessayer</Button><Link href="/dashboard" className={buttonVariants({ variant: "secondary" })}>Revenir à l’accueil</Link></div></div>;
}
