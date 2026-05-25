import { NextResponse } from "next/server";

export const maxDuration = 15;
export const revalidate = 300;

const ORG = "Rosenfelt-Group";

interface GitHubRepo {
  name: string;
  description: string | null;
  html_url: string;
  pushed_at: string | null;
  archived: boolean;
  private: boolean;
  default_branch: string;
}

interface RepoSummary {
  name: string;
  description: string | null;
  html_url: string;
  pushed_at: string | null;
  archived: boolean;
  private: boolean;
  default_branch: string;
}

let cache: { at: number; data: RepoSummary[] } | null = null;
const TTL_MS = 5 * 60_000;

export async function GET() {
  const token = process.env.GITHUB_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "missing_token", message: "GITHUB_API_TOKEN not configured on Vercel" },
      { status: 503 }
    );
  }

  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.data);
  }

  try {
    const res = await fetch(
      `https://api.github.com/orgs/${ORG}/repos?per_page=100&sort=pushed&direction=desc`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "rosably-dashboard",
        },
        next: { revalidate: 300 },
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: "github_api_error", status: res.status, message: await res.text() },
        { status: 502 }
      );
    }

    const repos = (await res.json()) as GitHubRepo[];
    const summary: RepoSummary[] = repos.map(r => ({
      name: r.name,
      description: r.description,
      html_url: r.html_url,
      pushed_at: r.pushed_at,
      archived: r.archived,
      private: r.private,
      default_branch: r.default_branch,
    }));

    cache = { at: Date.now(), data: summary };
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json(
      { error: "fetch_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
