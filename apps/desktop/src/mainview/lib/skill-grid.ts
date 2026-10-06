/** Expanded collections start a section; collapsed collections occupy a normal grid cell. */
export function packSkillRows<Row extends { kind: string; collapsed?: boolean }>(rows: Row[], columns: number): Row[][] {
  const width = Math.max(1, Math.floor(columns));
  const result: Row[][] = [];
  let group: Row[] = [];
  const cellKind = (row: Row) => row.kind === 'collection_header' && row.collapsed ? 'standalone' : row.kind;
  const flush = () => { if (group.length) result.push(group); group = []; };
  for (const row of rows) {
    if ((row.kind === 'collection_header' && !row.collapsed) || row.kind === 'section') {
      flush();
      result.push([row]);
    } else {
      if (group.length === width || (group.length && cellKind(group[0]!) !== cellKind(row))) flush();
      group.push(row);
    }
  }
  flush();
  return result;
}
