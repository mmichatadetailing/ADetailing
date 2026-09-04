import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-3 inline-flex rounded-full border border-brand-400/15 bg-brand-50/85 px-3 py-1 text-[10px] font-extrabold tracking-[0.18em] text-brand-600 uppercase shadow-sm">{eyebrow}</p>}
        <h1 className="text-balance text-2xl font-extrabold tracking-[-0.035em] text-zinc-200 sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
