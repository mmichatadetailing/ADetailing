import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="group/field grid gap-2 text-sm font-medium text-zinc-300">
      <span className="transition-colors duration-200 group-focus-within/field:text-brand-600">{label}</span>
      {children}
      {hint && !error && <span className="text-xs font-normal text-zinc-500">{hint}</span>}
      {error && <span className="text-xs font-medium text-red-300">{error}</span>}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("focus-ring min-h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm text-zinc-200 shadow-sm transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-zinc-600 hover:border-brand-400/25 hover:bg-brand-50/30 focus:border-brand-400/45 focus:bg-white focus:shadow-[0_0_0_4px_rgba(249,115,79,.08),0_8px_20px_rgba(78,64,120,.07)] disabled:bg-zinc-100 disabled:text-zinc-500 disabled:shadow-none", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("focus-ring min-h-11 w-full cursor-pointer rounded-xl border border-black/10 bg-white px-3 text-sm text-zinc-200 shadow-sm transition-[border-color,box-shadow,background-color] duration-200 hover:border-brand-400/25 hover:bg-brand-50/30 focus:border-brand-400/45 focus:bg-white focus:shadow-[0_0_0_4px_rgba(249,115,79,.08),0_8px_20px_rgba(78,64,120,.07)] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500 disabled:shadow-none", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("focus-ring min-h-28 w-full resize-y rounded-xl border border-black/10 bg-white p-3 text-sm text-zinc-200 shadow-sm transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-zinc-600 hover:border-brand-400/25 hover:bg-brand-50/30 focus:border-brand-400/45 focus:bg-white focus:shadow-[0_0_0_4px_rgba(249,115,79,.08),0_8px_20px_rgba(78,64,120,.07)] disabled:bg-zinc-100 disabled:text-zinc-500 disabled:shadow-none", className)} {...props} />;
}
