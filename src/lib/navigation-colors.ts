export type AccentTone = "blue" | "emerald" | "amber" | "violet" | "teal" | "rose" | "neutral";

const sectionTones: Record<string, AccentTone> = {
  dashboard: "blue",
  planning: "blue",
  pilotage: "blue",
  prestations: "amber",
  catalogue: "amber",
  entretiens: "teal",
  finances: "emerald",
  banque: "emerald",
  factures: "emerald",
  clients: "violet",
  equipe: "violet",
  inbox: "violet",
  compte: "violet",
};

/** Keep the same landmarks in desktop navigation, mobile navigation and page headings. */
export function sectionTone(pathname: string): AccentTone {
  const section = pathname.split(/[/?#]/).filter(Boolean)[0] ?? "";
  return sectionTones[section] ?? "neutral";
}
