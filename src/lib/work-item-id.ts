// Resolves an inbound /work/[id] param to the correct work_items column.
// A purely-numeric param is a friendly `ref`; anything else is the UUID `id`
// (UUIDs always contain hyphens/hex letters, so they never match /^\d+$/).
export function workItemIdFilter(
  id: string,
): { column: "ref" | "id"; value: number | string } {
  return /^\d+$/.test(id)
    ? { column: "ref", value: Number(id) }
    : { column: "id", value: id };
}
