// 네이버 블로그 조회수 — naver-blog-scraper 수집분
// 스크래퍼가 다중 블로그를 지원하면서 { updatedAt, blogs: [...] } 형식이 됐다.
// 아직 재수집 전이면 구형식(블로그 1개가 최상위에 평평하게)이 올 수 있어 둘 다 받는다.

export interface BlogStat {
  blogId?: string;
  label?: string;
  today: number;
  yesterday: number;
  last7: number;
  last30: number;
  views?: { dates: string[]; values: number[] };
  visitors?: { today: number; last7: number } | null;
  error?: string;
  loggedOut?: boolean;
}

export interface NaverBlogPayload extends Partial<BlogStat> {
  updatedAt: string | null;
  blogs?: BlogStat[];
  note?: string;
}

const FALLBACK_LABEL = "다인아이앤씨 블로그";

/** 신·구 형식을 블로그 배열 하나로 통일한다. */
export function toBlogList(p: NaverBlogPayload | null): BlogStat[] {
  if (!p) return [];

  if (Array.isArray(p.blogs)) {
    return p.blogs.map((b) => ({ ...b, label: b.label || b.blogId || FALLBACK_LABEL }));
  }

  // 구형식: 최상위가 곧 블로그 1개. 수집 전(note만 있는 상태)이면 빈 배열.
  const hasStats = typeof p.today === "number";
  if (!hasStats && !p.error && !p.loggedOut) return [];

  return [
    {
      blogId: p.blogId,
      label: FALLBACK_LABEL,
      today: p.today ?? 0,
      yesterday: p.yesterday ?? 0,
      last7: p.last7 ?? 0,
      last30: p.last30 ?? 0,
      views: p.views,
      visitors: p.visitors,
      error: p.error,
      loggedOut: p.loggedOut,
    },
  ];
}

export async function fetchNaverBlog(): Promise<NaverBlogPayload> {
  const r = await fetch("/api/naver-blog");
  if (!r.ok) throw new Error("naver-blog " + r.status);
  return (await r.json()) as NaverBlogPayload;
}
