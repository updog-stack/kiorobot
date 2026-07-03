// 유튜브 채널 지표 데이터 레이어 — BFF(/api/youtube)가 YouTube Data API로 조회.

export interface YtVideo {
  id: string;
  title: string;
  views: number;
  publishedAt: string | null;
  url: string;
  thumb: string | null;
}

export interface YoutubeStats {
  channelTitle: string;
  thumb: string | null;
  url: string;
  subscribers: number;
  totalViews: number;
  videoCount: number;
  recentVideos: YtVideo[];
  updatedAt: string;
}

export async function fetchYoutube(): Promise<YoutubeStats> {
  const res = await fetch("/api/youtube");
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `유튜브 조회 실패: ${res.status}`);
  return body as YoutubeStats;
}
