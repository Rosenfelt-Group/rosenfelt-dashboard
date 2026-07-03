"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Sam's agent_prompts row emits Markdown (not HTML like the other agents,
// which speak Telegram HTML parse_mode). Chat surfaces that render Sam's
// replies as raw text need this so **bold**/`code`/tables don't show as
// literal punctuation.
export function SamMarkdown({ content }: { content: string }) {
  return (
    <div
      className="prose prose-sm max-w-none
        prose-p:my-1 prose-p:leading-relaxed prose-p:text-inherit
        prose-headings:mt-2 prose-headings:mb-1 prose-headings:font-semibold prose-headings:text-inherit
        prose-strong:text-inherit prose-em:text-inherit
        prose-a:text-brand-orange prose-a:no-underline hover:prose-a:underline
        prose-code:bg-black/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.85em] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
        prose-pre:bg-black/5 prose-pre:text-inherit prose-pre:rounded-lg prose-pre:text-xs
        prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-li:text-inherit
        prose-table:text-xs prose-th:text-inherit prose-td:text-inherit
        prose-blockquote:border-brand-orange prose-blockquote:text-inherit"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
