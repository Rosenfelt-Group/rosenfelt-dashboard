"use client";

export default function AdvertisingTab() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 bg-brand-offwhite rounded-2xl flex items-center justify-center mb-5">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-brand-muted">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
          <polyline points="17 6 23 6 23 12"/>
        </svg>
      </div>
      <p className="text-sm font-medium text-brand-black mb-1">Advertising Management</p>
      <p className="text-xs text-brand-muted max-w-xs">
        Track paid advertising channels — Google Ads, LinkedIn, and more. Coming soon.
      </p>
    </div>
  );
}
