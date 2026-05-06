import { NextResponse } from "next/server";

export async function GET() {
  const wpUrl = process.env.WP_URL;
  const wpAuth = process.env.WP_AUTH;
  if (!wpUrl || !wpAuth) {
    return NextResponse.json({ error: "WordPress not configured" }, { status: 503 });
  }

  const base = `${wpUrl}/wp-json/wp/v2`;
  const headers = {
    Authorization: `Basic ${wpAuth}`,
    Accept: "application/json",
  };
  const fields = "id,title,status,link,modified";

  const [pagesRes, postsRes] = await Promise.all([
    fetch(`${base}/pages?per_page=100&_fields=${fields}`, { headers, next: { revalidate: 60 } }),
    fetch(`${base}/posts?per_page=100&_fields=${fields}`, { headers, next: { revalidate: 60 } }),
  ]);

  if (!pagesRes.ok || !postsRes.ok) {
    return NextResponse.json({ error: "WordPress fetch failed" }, { status: 502 });
  }

  const [pages, posts]: [WpItem[], WpItem[]] = await Promise.all([pagesRes.json(), postsRes.json()]);

  const combined = [
    ...pages.map(p => toEntry(p, "page", wpUrl)),
    ...posts.map(p => toEntry(p, "post", wpUrl)),
  ].sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

  return NextResponse.json(combined);
}

interface WpItem {
  id: number;
  title: { rendered: string };
  status: string;
  link: string;
  modified: string;
}

function toEntry(p: WpItem, type: "page" | "post", wpUrl: string) {
  return {
    id: p.id,
    title: p.title?.rendered ?? "",
    status: p.status,
    type,
    url: p.link,
    editUrl: `${wpUrl}/wp-admin/post.php?post=${p.id}&action=edit`,
    modified: p.modified,
  };
}
