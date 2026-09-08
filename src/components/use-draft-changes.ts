"use client";

import { useEffect, useState } from "react";
import { draftSnapshots, hasDraftChanges } from "@/lib/domain/draft-changes";

export function useDraftChanges(groups: Record<string, unknown>, onDirtyChange?: (dirty: boolean) => void) {
  const snapshots = draftSnapshots(groups);
  const [saved, setSaved] = useState(snapshots);
  const dirty = hasDraftChanges(saved, snapshots);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const markSaved = (keys: string[], overrides: Record<string, unknown> = {}) => {
    setSaved((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, Object.hasOwn(overrides, key) ? JSON.stringify(overrides[key]) : snapshots[key]!])) }));
  };
  return { dirty, markSaved };
}
