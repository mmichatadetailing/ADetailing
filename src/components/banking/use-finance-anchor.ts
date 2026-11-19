"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

function subscribe(notify: () => void) {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
}
function readHash() {
  try { return decodeURIComponent(window.location.hash.slice(1)); } catch { return ""; }
}

/** The bank link can arrive before the workspace records have finished hydrating. */
export function useFinanceAnchor(prefix: string, records: ReadonlyArray<{ id: string }>, enabled = true) {
  const hash = useSyncExternalStore(subscribe, readHash, () => "");
  const id = enabled && hash.startsWith(prefix) ? hash.slice(prefix.length) : "";
  const last = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = id && records.some((entry) => entry.id === id) ? document.getElementById(prefix + id) : null;
    if (node && node !== last.current) {
      node.focus({ preventScroll: true });
      node.scrollIntoView({ block: "center" });
    }
    last.current = node;
  }, [id, prefix, records]);
  return id;
}
