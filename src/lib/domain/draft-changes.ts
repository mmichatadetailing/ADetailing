export function draftSnapshots(groups: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, JSON.stringify(value)]));
}

export function hasDraftChanges(saved: Record<string, string>, current: Record<string, string>) {
  return Object.keys(current).some((key) => saved[key] !== current[key]);
}
