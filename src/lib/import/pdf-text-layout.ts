export interface PositionedPdfText {
  str: string;
  x: number;
  y: number;
}

export function reconstructVisualRows(items: PositionedPdfText[]) {
  const rows: Array<{ y: number; items: PositionedPdfText[] }> = [];
  for (const item of [...items].sort((left, right) => right.y - left.y || left.x - right.x)) {
    const row = rows.find((entry) => Math.abs(entry.y - item.y) <= 2);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  return rows
    .sort((left, right) => right.y - left.y)
    .map((row) => row.items.sort((left, right) => left.x - right.x).map((item) => item.str.trim()).filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n");
}
