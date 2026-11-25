import type { OrchestrationV2ThreadShell as Row, ThreadId } from "@t3tools/contracts";

const indexes = new WeakMap<readonly Row[], ReadonlyMap<ThreadId, number>>();

export function threadPositions(rows: readonly Row[]) {
  let positions = indexes.get(rows);
  if (positions === undefined) {
    const built = new Map<ThreadId, number>();
    rows.forEach((row, i) => built.set(row.id, i));
    indexes.set(rows, built);
    positions = built;
  }
  return positions;
}

export function upsertIndexedThread(rows: readonly Row[], row: Row) {
  const positions = threadPositions(rows);
  const at = positions.get(row.id);
  if (at === undefined) return [...rows, row];
  const next = rows.slice();
  next[at] = row;
  indexes.set(next, positions);
  return next;
}

// Point reads share positions. Each view still reads the immutable rows of its own snapshot.
export function threadIndex(rows: readonly Row[]): ReadonlyMap<ThreadId, Row> {
  const positions = threadPositions(rows);
  let materialized: Map<ThreadId, Row> | undefined;
  const entries = () => materialized ??= new Map(rows.map((row) => [row.id, row]));
  const view: ReadonlyMap<ThreadId, Row> = {
    size: positions.size,
    has: (id) => positions.has(id),
    get: (id) => {
      const at = positions.get(id);
      return at === undefined ? undefined : rows[at];
    },
    keys: () => positions.keys(),
    values: () => entries().values(),
    entries: () => entries().entries(),
    [Symbol.iterator]: () => entries().entries(),
    forEach: (callback, self) => entries().forEach((row, id) => callback.call(self, row, id, view)),
  };
  return view;
}
