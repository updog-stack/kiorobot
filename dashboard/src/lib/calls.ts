// 인입 현황(전화·채팅) 요일×시간 히트맵 데이터 레이어 — 채널톡 userChat 집계.

export interface CallItem {
  name: string; // 매장(고객)명
  url: string; // 채널톡 상담 링크
  medium: string; // 전화 | 채팅
  tags: string; // 상담 태그
  at: number; // createdAt(ms)
}

export interface CallSeries {
  id: string; // all | phone | chat | dain | amudo | etc
  label: string;
  total: number;
  grid: number[][]; // [7][24]
  max: number;
  items: CallItem[]; // 해당 항목의 상담 목록(클릭 확인용)
}

export interface CallsData {
  updatedAt: string;
  source: string; // "channeltalk" | "none"
  days: number;
  series: CallSeries[];
  note?: string;
}

export async function fetchCalls(days = 7): Promise<CallsData> {
  // _t: 캐시 방지(매 호출 고유 URL), no-store: 브라우저 캐시 사용 안 함
  const res = await fetch(`/api/calls?days=${days}&_t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`인입 현황 조회 실패: ${res.status}`);
  return (await res.json()) as CallsData;
}
