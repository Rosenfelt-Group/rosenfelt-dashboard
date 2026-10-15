export type StorageObjectRef = { bucket: string; object_name: string };
export interface StorageLike {
  from(bucket: string): { remove(paths: string[]): PromiseLike<{ data: unknown; error: unknown }> };
}

// Only buckets that hold room deliverables. Anything else in the list is refused, never removed.
export const CLEANUP_BUCKETS = ["prototypes", "room-documents"] as const;
const CHUNK = 1000;

export async function removeObjects(storage: StorageLike, objects: StorageObjectRef[]): Promise<{ removed: number; failed: number }> {
  const byBucket = new Map<string, string[]>();
  let failed = 0;
  for (const o of objects) {
    if (!(CLEANUP_BUCKETS as readonly string[]).includes(o.bucket) || typeof o.object_name !== "string" || !o.object_name) {
      failed++;
      continue;
    }
    const list = byBucket.get(o.bucket) ?? [];
    list.push(o.object_name);
    byBucket.set(o.bucket, list);
  }
  let removed = 0;
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += CHUNK) {
      const chunk = names.slice(i, i + CHUNK);
      try {
        const { error } = await storage.from(bucket).remove(chunk);
        if (error) failed += chunk.length;
        else removed += chunk.length;
      } catch {
        failed += chunk.length;
      }
    }
  }
  return { removed, failed };
}
