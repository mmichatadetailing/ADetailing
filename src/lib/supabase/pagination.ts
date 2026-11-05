// Chaque requête conserve les filtres de l’organisation et les droits RLS.
export async function readAllPages<T>(
  readPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 500,
): Promise<T[]> {
  const records: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const result = await readPage(offset, offset + pageSize - 1);
    if (result.error) throw result.error;
    const batch = result.data ?? [];
    records.push(...batch);
    if (batch.length < pageSize) return records;
  }
}
