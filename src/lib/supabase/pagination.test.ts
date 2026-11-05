import { expect, it } from "vitest";
import { readAllPages } from "./pagination";

it("ne tronque pas un export de plus de mille lignes", async () => {
  const source = Array.from({ length: 1251 }, (_, id) => ({ id }));
  const ranges: number[][] = [];
  const records = await readAllPages(async (from, to) => {
    ranges.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  });
  expect(records).toEqual(source);
  expect(ranges).toEqual([[0, 499], [500, 999], [1000, 1499]]);
});
it("n’exporte pas silencieusement un fichier incomplet après une erreur", async () => {
  await expect(readAllPages(async (from) => from === 0
    ? { data: Array.from({ length: 500 }, (_, id) => id), error: null }
    : { data: null, error: { message: "Lecture refusée" } })).rejects.toEqual({ message: "Lecture refusée" });
});
