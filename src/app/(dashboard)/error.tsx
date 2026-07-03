"use client";
import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard page render error:", error);
  }, [error]);

  return (
    <div className="p-4 md:p-8 max-w-lg">
      <div className="card border-red-200 bg-red-50">
        <p className="text-sm font-medium text-red-700">Something went wrong loading this page.</p>
        <p className="text-xs text-red-600 mt-1 break-words">{error.message}</p>
        <button
          onClick={reset}
          className="mt-3 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
