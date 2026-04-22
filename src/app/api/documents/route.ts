import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DOCS_ROOT = process.env.DOCS_PATH ?? "/opt/rosenfelt/docs";

interface DocEntry {
  name:     string;
  path:     string;
  ext:      string;
  size:     number;
  modified: string;
  isDir:    boolean;
}

function readDir(dir: string, base: string): DocEntry[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => !e.name.startsWith("."))
    .map(e => {
      const full    = path.join(dir, e.name);
      const relPath = path.join(base, e.name).replace(/\\/g, "/");
      const stat    = fs.statSync(full);
      return {
        name:     e.name,
        path:     relPath,
        ext:      e.isFile() ? path.extname(e.name).toLowerCase().slice(1) : "",
        size:     stat.size,
        modified: stat.mtime.toISOString(),
        isDir:    e.isDirectory(),
      };
    })
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export async function GET() {
  if (!fs.existsSync(DOCS_ROOT)) {
    return NextResponse.json({ error: "docs_not_found", root: DOCS_ROOT, entries: [] });
  }
  const entries = readDir(DOCS_ROOT, "");
  return NextResponse.json({ root: DOCS_ROOT, entries });
}
