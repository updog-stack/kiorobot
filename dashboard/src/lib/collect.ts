// 전체 데이터 동기화(수집) — BFF(/api/collect)가 스크래퍼 실행 + 캐시 갱신.

export interface CollectState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  errors: string[];
  auto: boolean;
}

export async function startCollect(): Promise<void> {
  const res = await fetch("/api/collect", { method: "POST" });
  if (!res.ok && res.status !== 409) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b?.error || `동기화 시작 실패: ${res.status}`);
  }
}

export async function getCollectStatus(): Promise<CollectState> {
  const res = await fetch("/api/collect/status");
  if (!res.ok) throw new Error(`상태 조회 실패: ${res.status}`);
  return (await res.json()) as CollectState;
}
