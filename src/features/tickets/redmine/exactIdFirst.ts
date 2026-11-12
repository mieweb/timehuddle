/**
 * The search bar's rows with any whose ID is exactly what was typed moved to
 * the top: `PM0-1` first, before `PM0-120` and `PM0-15`, whichever group it
 * came in. The rest keep their order.
 */
export function exactIdFirst<T>(rows: T[], query: string, idsOf: (row: T) => string[]): T[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return rows;
  const isExact = (row: T) => idsOf(row).some((id) => id.toLowerCase() === wanted);
  return [...rows.filter(isExact), ...rows.filter((row) => !isExact(row))];
}
