import { NextResponse } from "next/server";

export const maxDuration = 30;

interface WPPost {
  id: number;
  date: string;
  modified: string;
  status: string;
  link: string;
  title: { rendered: string } | { raw: string; rendered: string };
  author: number;
}

interface WPPlugin {
  plugin: string;
  status: "active" | "inactive";
  name: string;
  plugin_uri: string;
  version: string;
  author: string;
  author_uri: string;
  description: { raw: string; rendered: string } | string;
}

interface WPTheme {
  stylesheet: string;
  template: string;
  status: string;
  name: { raw: string; rendered: string } | string;
  version: string;
  theme_uri: string;
}

interface PostSummary {
  id: number;
  title: string;
  status: string;
  date: string;
  modified: string;
  edit_url: string;
  view_url: string;
}

interface PluginInfo {
  plugin: string;
  slug: string;
  name: string;
  current_version: string;
  latest_version: string | null;
  update_available: boolean;
  status: "active" | "inactive";
  plugin_uri: string;
}

interface ThemeInfo {
  stylesheet: string;
  name: string;
  version: string;
  is_active: boolean;
}

interface WordpressStatus {
  configured: boolean;
  wp_url: string | null;
  fetched_at: string;
  posts: {
    pending: PostSummary[];
    draft: PostSummary[];
    future: PostSummary[];
  };
  core: {
    current_version: string | null;
    latest_version: string | null;
    update_available: boolean;
  };
  themes: {
    active: ThemeInfo | null;
    all: ThemeInfo[];
  };
  plugins: PluginInfo[];
  errors: string[];
}

let cache: { at: number; data: WordpressStatus } | null = null;
const TTL_MS = 10 * 60_000;

function getTitle(t: WPPost["title"]): string {
  if (typeof t === "object" && "rendered" in t) return t.rendered;
  return "Untitled";
}

function getThemeName(n: WPTheme["name"]): string {
  if (typeof n === "string") return n;
  if (typeof n === "object" && "rendered" in n) return n.rendered;
  return "Unknown";
}

function pluginToSlug(plugin: string): string {
  return plugin.split("/")[0];
}

async function fetchWP<T>(url: string, auth: string, errors: string[]): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      errors.push(`${url.split("/wp-json/")[1] ?? url}: HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    errors.push(`${url.split("/wp-json/")[1] ?? url}: ${e instanceof Error ? e.message : "fetch failed"}`);
    return null;
  }
}

async function fetchLatestPluginVersion(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.wordpress.org/plugins/info/1.0/${slug}.json`, {
      headers: { Accept: "application/json", "User-Agent": "rosably-dashboard" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

async function fetchLatestWPVersion(): Promise<string | null> {
  try {
    const res = await fetch("https://api.wordpress.org/core/version-check/1.7/", {
      headers: { Accept: "application/json", "User-Agent": "rosably-dashboard" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.offers?.[0]?.version ?? null;
  } catch {
    return null;
  }
}

async function fetchCurrentWPVersion(wpUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${wpUrl}/`, {
      headers: { "User-Agent": "rosably-dashboard" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<meta name=["']generator["'] content=["']WordPress\s+([0-9.]+)/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(n => parseInt(n, 10) || 0);
  const pb = b.split(".").map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export async function GET() {
  const wpUrl = process.env.WP_URL?.replace(/\/$/, "");
  const wpAuth = process.env.WP_AUTH;

  if (!wpUrl || !wpAuth) {
    return NextResponse.json({
      configured: false,
      wp_url: null,
      fetched_at: new Date().toISOString(),
      posts: { pending: [], draft: [], future: [] },
      core: { current_version: null, latest_version: null, update_available: false },
      themes: { active: null, all: [] },
      plugins: [],
      errors: ["WP_URL or WP_AUTH not configured on Vercel"],
    } satisfies WordpressStatus);
  }

  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.data);
  }

  const errors: string[] = [];

  const [pendingPosts, draftPosts, futurePosts, plugins, themes, currentWPVersion, latestWPVersion] = await Promise.all([
    fetchWP<WPPost[]>(`${wpUrl}/wp-json/wp/v2/posts?status=pending&per_page=20&context=edit&_fields=id,title,status,date,modified,link,author`, wpAuth, errors),
    fetchWP<WPPost[]>(`${wpUrl}/wp-json/wp/v2/posts?status=draft&per_page=20&context=edit&_fields=id,title,status,date,modified,link,author`, wpAuth, errors),
    fetchWP<WPPost[]>(`${wpUrl}/wp-json/wp/v2/posts?status=future&per_page=20&context=edit&_fields=id,title,status,date,modified,link,author`, wpAuth, errors),
    fetchWP<WPPlugin[]>(`${wpUrl}/wp-json/wp/v2/plugins`, wpAuth, errors),
    fetchWP<WPTheme[]>(`${wpUrl}/wp-json/wp/v2/themes`, wpAuth, errors),
    fetchCurrentWPVersion(wpUrl),
    fetchLatestWPVersion(),
  ]);

  const mapPost = (p: WPPost): PostSummary => ({
    id: p.id,
    title: getTitle(p.title),
    status: p.status,
    date: p.date,
    modified: p.modified,
    edit_url: `${wpUrl}/wp-admin/post.php?post=${p.id}&action=edit`,
    view_url: p.link,
  });

  const pluginInfos: PluginInfo[] = [];
  if (plugins) {
    const latestVersions = await Promise.all(
      plugins.map(p => fetchLatestPluginVersion(pluginToSlug(p.plugin)))
    );
    plugins.forEach((p, i) => {
      const latest = latestVersions[i];
      const updateAvailable = latest ? compareVersions(latest, p.version) > 0 : false;
      pluginInfos.push({
        plugin: p.plugin,
        slug: pluginToSlug(p.plugin),
        name: p.name,
        current_version: p.version,
        latest_version: latest,
        update_available: updateAvailable,
        status: p.status,
        plugin_uri: p.plugin_uri,
      });
    });
    pluginInfos.sort((a, b) => {
      if (a.update_available !== b.update_available) return a.update_available ? -1 : 1;
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  const themeInfos: ThemeInfo[] = (themes ?? []).map(t => ({
    stylesheet: t.stylesheet,
    name: getThemeName(t.name),
    version: t.version,
    is_active: t.status === "active",
  }));
  const activeTheme = themeInfos.find(t => t.is_active) ?? null;

  const coreUpdateAvailable = !!(currentWPVersion && latestWPVersion && compareVersions(latestWPVersion, currentWPVersion) > 0);

  const data: WordpressStatus = {
    configured: true,
    wp_url: wpUrl,
    fetched_at: new Date().toISOString(),
    posts: {
      pending: (pendingPosts ?? []).map(mapPost),
      draft: (draftPosts ?? []).map(mapPost),
      future: (futurePosts ?? []).map(mapPost),
    },
    core: {
      current_version: currentWPVersion,
      latest_version: latestWPVersion,
      update_available: coreUpdateAvailable,
    },
    themes: { active: activeTheme, all: themeInfos },
    plugins: pluginInfos,
    errors,
  };

  cache = { at: Date.now(), data };
  return NextResponse.json(data);
}
