// No imports: safe to use from client components.
export const DOC_MAX_BYTES = 25 * 1024 * 1024; // must equal the room-documents bucket file_size_limit (26214400)
export const DOC_ACCEPT = ".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.txt,.csv,.md";
export const DOC_BUCKET = "room-documents";

// After a "new document" prep call has created a deliverable, later failures must not make the retry
// create another one: adopt the returned id as the target.
export const targetAfterPrep = (currentTarget: string, prepDeliverableId: string): string => currentTarget || prepDeliverableId;
