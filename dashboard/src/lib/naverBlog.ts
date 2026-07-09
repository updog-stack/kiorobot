// 네이버 블로그(dain_inc) 조회수 — naver-blog-scraper 수집분
export interface NaverBlog {
  updatedAt: string | null;
  blogId?: string;
  today: number;
  yesterday: number;
  last7: number;
  last30: number;
  views?: { dates: string[]; values: number[] };
  visitors?: { today: number; last7: number } | null;
  note?: string;
  error?: string;
  loggedOut?: boolean;
}

export async function fetchNaverBlog(): Promise<NaverBlog> {
  const r = await fetch("/api/naver-blog");
  if (!r.ok) throw new Error("naver-blog " + r.status);
  return (await r.json()) as NaverBlog;
}
