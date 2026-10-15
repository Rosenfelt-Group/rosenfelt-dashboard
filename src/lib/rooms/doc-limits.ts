// No imports: safe to use from client components.
export const DOC_MAX_BYTES = 25 * 1024 * 1024; // must equal the room-documents bucket file_size_limit (26214400)
export const DOC_ACCEPT = ".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.txt,.csv,.md";
export const DOC_BUCKET = "room-documents";

// After a "new document" prep call has created a deliverable, later failures must not make the retry
// create another one: adopt the returned id as the target.
export const targetAfterPrep = (currentTarget: string, prepDeliverableId: string): string => currentTarget || prepDeliverableId;

// Types the dashboard can show inline (served by the preview host /dp route). Office formats are download-only.
export const PREVIEWABLE_DOC_EXTS = ["pdf", "png", "jpg", "txt", "csv", "md"] as const;
export const canPreviewDoc = (ext: unknown): boolean =>
  typeof ext === "string" && (PREVIEWABLE_DOC_EXTS as readonly string[]).includes(ext.toLowerCase());
