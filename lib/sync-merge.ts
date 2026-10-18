/** Merge local and remote rows by id, keeping the newer `at`, then cap. */
export function mergeByIdAt<T extends { id: string; at: number }>(
  local: T[],
  remote: T[],
  max: number,
): T[] {
  const map = new Map<string, T>();
  for (const item of [...remote, ...local]) {
    if (!item || typeof item.id !== "string") continue;
    const prev = map.get(item.id);
    if (!prev || item.at >= prev.at) map.set(item.id, item);
  }
  return [...map.values()].sort((a, b) => b.at - a.at).slice(0, max);
}
