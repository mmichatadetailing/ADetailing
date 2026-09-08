"use client";

import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./button";
import { cn } from "@/lib/utils";
import { lockBodyScroll } from "@/lib/scroll-lock";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controls = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex='0']") ?? []).filter((element) => !element.matches(":disabled") && element.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => controls()[0]?.focus({ preventScroll: true }));
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const elements = controls();
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handler);
    const releaseScroll = lockBodyScroll();
    return () => {
      document.removeEventListener("keydown", handler);
      releaseScroll();
      cancelAnimationFrame(frame);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="modal-backdrop fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/30 p-0 backdrop-blur-sm sm:items-start sm:p-6" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn("modal-panel max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-black/[0.1] bg-white shadow-[0_28px_90px_rgba(47,40,72,.22)] sm:my-auto sm:max-w-xl sm:rounded-3xl", className)}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-black/[0.07] bg-white/90 p-5 backdrop-blur-xl">
          <div>
            <h2 id={titleId} className="text-lg font-bold tracking-tight">{title}</h2>
            {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer"><X className="size-4" /></Button>
        </header>
        <div className="p-5">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
