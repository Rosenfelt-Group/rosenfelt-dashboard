"use client";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";

interface ImageEntry {
  name:      string;
  path:      string;
  directory: string;
  size:      number;
  extension: string;
}

const WEB_PREVIEWABLE = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"]);

function imgSrc(path: string) {
  return `/api/images/content?path=${encodeURIComponent(path)}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {open
        ? <polyline points="15 18 9 12 15 6"/>
        : <polyline points="9 18 15 12 9 6"/>
      }
    </svg>
  );
}

function ImageIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand-muted">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  );
}

function FileTypeIcon({ ext }: { ext: string }) {
  return (
    <div className="w-10 h-10 rounded-lg bg-brand-offwhite border border-brand-border flex items-center justify-center">
      <span className="text-[10px] font-bold uppercase text-brand-muted">.{ext}</span>
    </div>
  );
}

function ImageRow({ img, selected, onSelect }: {
  img:      ImageEntry;
  selected: ImageEntry | null;
  onSelect: (img: ImageEntry) => void;
}) {
  const isActive   = selected?.path === img.path;
  const canPreview = WEB_PREVIEWABLE.has(img.extension);

  return (
    <button
      onClick={() => onSelect(img)}
      className={clsx(
        "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
        isActive
          ? "bg-brand-orange/10 border-l-2 border-brand-orange"
          : "border-l-2 border-transparent hover:bg-brand-offwhite"
      )}
    >
      <div className="w-9 h-9 rounded flex-shrink-0 bg-brand-offwhite border border-brand-border overflow-hidden flex items-center justify-center">
        {canPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imgSrc(img.path)} alt="" className="w-full h-full object-contain" />
        ) : (
          <span className="text-[9px] font-bold uppercase text-brand-muted">{img.extension}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={clsx("text-xs truncate", isActive ? "font-medium text-brand-black" : "text-brand-black")}>
          {img.name}
        </p>
        <p className="text-[10px] text-brand-muted">{formatSize(img.size)}</p>
      </div>
    </button>
  );
}

export default function ImagesPage() {
  const [images,   setImages]   = useState<ImageEntry[]>([]);
  const [selected, setSelected] = useState<ImageEntry | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(true);

  useEffect(() => {
    fetch("/api/images/list")
      .then(r => r.json())
      .then(data => {
        if (data.error) setError(data.error);
        else setImages(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load image library");
        setLoading(false);
      });
  }, []);

  const directories = useMemo(
    () => Array.from(new Set(images.map(i => i.directory))).sort(),
    [images]
  );

  const canPreview = selected ? WEB_PREVIEWABLE.has(selected.extension) : false;

  return (
    <div className="p-4 md:p-8 pt-16 md:pt-8 pb-24 md:pb-8">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-brand-black">Images</h1>
        <p className="text-sm text-brand-muted mt-0.5">
          {loading
            ? "Loading…"
            : error
            ? "Failed to load image library"
            : `${images.length} image${images.length !== 1 ? "s" : ""} available`}
        </p>
      </div>

      <div className="flex gap-4" style={{ height: "calc(100dvh - 14rem)" }}>

        {/* Left panel */}
        {listOpen && (
          <div className="w-56 flex-shrink-0 card p-0 overflow-y-auto">
            {loading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="animate-pulse h-11 bg-brand-offwhite rounded" />
                ))}
              </div>
            ) : error ? (
              <div className="p-4 text-xs text-red-600 font-medium">{error}</div>
            ) : images.length === 0 ? (
              <div className="p-6 text-center text-xs text-brand-muted">No images found</div>
            ) : (
              directories.map(dir => {
                const dirImages = images.filter(i => i.directory === dir);
                return (
                  <div key={dir}>
                    <div className="px-3 pt-3 pb-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted truncate" title={dir}>
                        {dir}
                      </p>
                    </div>
                    {dirImages.map(img => (
                      <ImageRow key={img.path} img={img} selected={selected} onSelect={setSelected} />
                    ))}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Right panel */}
        <div className="card flex-1 overflow-hidden flex flex-col min-w-0">
          {/* Panel header */}
          <div className="px-3 py-2.5 border-b border-brand-border flex items-center gap-2 flex-shrink-0 flex-wrap">
            <button
              onClick={() => setListOpen(!listOpen)}
              title={listOpen ? "Collapse image list" : "Show image list"}
              className="p-1 rounded hover:bg-brand-offwhite text-brand-muted hover:text-brand-black transition-colors flex-shrink-0"
            >
              <ChevronIcon open={listOpen} />
            </button>
            {selected ? (
              <>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-brand-black truncate">{selected.name}</p>
                  <p className="text-[11px] text-brand-muted truncate">{selected.path}</p>
                </div>
                <a
                  href={imgSrc(selected.path)}
                  download={selected.name}
                  className="text-xs px-2.5 py-1 rounded-lg border border-brand-border text-brand-muted
                             hover:bg-brand-offwhite hover:text-brand-black transition-colors flex-shrink-0"
                >
                  Download
                </a>
              </>
            ) : (
              <p className="text-sm text-brand-muted">
                {listOpen ? "Select an image to preview" : "Open image list to browse"}
              </p>
            )}
          </div>

          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="w-12 h-12 bg-brand-offwhite rounded-xl flex items-center justify-center mb-4">
                <ImageIcon size={24} />
              </div>
              <p className="text-sm font-medium text-brand-black mb-1">Select an image</p>
              <p className="text-xs text-brand-muted">
                {listOpen
                  ? "Choose a file from the list to preview it"
                  : "Tap the arrow to open the image list"}
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-auto flex flex-col min-h-0">
              {/* Preview area */}
              <div className="flex-1 flex items-center justify-center p-6 bg-[repeating-conic-gradient(#f0ece6_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]">
                {canPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={selected.path}
                    src={imgSrc(selected.path)}
                    alt={selected.name}
                    className="max-w-full object-contain shadow rounded bg-white"
                    style={{ maxHeight: "calc(100dvh - 22rem)" }}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 text-center">
                    <FileTypeIcon ext={selected.extension} />
                    <p className="text-sm text-brand-muted">No browser preview for .{selected.extension} files</p>
                    <a
                      href={imgSrc(selected.path)}
                      download={selected.name}
                      className="text-sm px-4 py-2 rounded-lg bg-brand-orange text-white hover:opacity-90 transition-opacity"
                    >
                      Download file
                    </a>
                  </div>
                )}
              </div>

              {/* Metadata strip */}
              <div className="px-4 py-3 border-t border-brand-border flex items-center gap-6 flex-shrink-0 flex-wrap">
                <div>
                  <p className="text-[10px] text-brand-muted uppercase tracking-wider">Format</p>
                  <p className="text-xs font-medium text-brand-black uppercase">{selected.extension}</p>
                </div>
                <div>
                  <p className="text-[10px] text-brand-muted uppercase tracking-wider">Size</p>
                  <p className="text-xs font-medium text-brand-black">{formatSize(selected.size)}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-brand-muted uppercase tracking-wider">Path</p>
                  <p className="text-xs font-mono text-brand-muted truncate">{selected.path}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
