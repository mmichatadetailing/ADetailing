import { LoaderCircle } from "lucide-react";

export default function LoadingPage() {
  return <div role="status" className="flex min-h-64 items-center justify-center gap-3 text-sm text-zinc-500"><LoaderCircle className="size-5 animate-spin text-brand-500" /> Chargement de la page…</div>;
}
