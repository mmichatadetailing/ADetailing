"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, LoaderCircle, PanelRightClose } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { lockBodyScroll } from "@/lib/scroll-lock";

export function PlanningSidePanel({ title, description, contentKey, dirty, busy, onClose, onPrevious, onNext, actions, children }: {
  title: string;
  description?: string;
  contentKey: string;
  dirty: boolean;
  busy: boolean;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
      closeRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [contentKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A date picker or discard confirmation takes precedence over the panel.
      if (document.querySelector(".modal-backdrop")) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (mobile && event.key === "Tab") {
        const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']") ?? []).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobile, onClose]);

  useEffect(() => {
    if (!mobile) return;
    const background = document.getElementById("app-shell");
    const wasInert = background?.inert ?? false;
    if (background) background.inert = true;
    const releaseScroll = lockBodyScroll();
    return () => {
      if (background) background.inert = wasInert;
      releaseScroll();
    };
  }, [mobile]);

  useEffect(() => {
    if (!dirty && !busy) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, busy]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <section ref={panelRef} className="planning-side-panel" data-planning-panel role={mobile ? "dialog" : "complementary"} aria-modal={mobile || undefined} aria-labelledby={titleId} aria-busy={busy}>
      <header className="shrink-0 border-b border-black/[.08] bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <Button ref={closeRef} variant="ghost" size="sm" disabled={busy} onClick={onClose} aria-label="Fermer la fiche et revenir au calendrier"><ArrowLeft className="size-4 lg:hidden" /><PanelRightClose className="hidden size-4 lg:block" /> <span className="lg:hidden">Retour au calendrier</span><span className="hidden lg:inline">Fermer la fiche</span></Button>
          <div className="flex items-center gap-1">{actions}<Button size="icon" variant="ghost" className="size-8 min-h-8" disabled={busy || !onPrevious} onClick={onPrevious} aria-label="Événement précédent"><ChevronLeft className="size-4" /></Button><Button size="icon" variant="ghost" className="size-8 min-h-8" disabled={busy || !onNext} onClick={onNext} aria-label="Événement suivant"><ChevronRight className="size-4" /></Button></div>
        </div>
        <h2 id={titleId} className="break-words text-lg font-extrabold tracking-tight text-slate-900">{title}</h2>
        {description && <p className="mt-1 text-xs text-slate-600">{description}</p>}
        {busy ? <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-sky-700" role="status"><LoaderCircle className="size-3 animate-spin" /> Enregistrement…</p> : dirty && <p className="mt-2 text-xs font-semibold text-amber-800" role="status">Modifications non enregistrées</p>}
      </header>
      <div ref={bodyRef} className="planning-panel-body min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-8">{children}</div>
    </section>, document.body,
  );
}
