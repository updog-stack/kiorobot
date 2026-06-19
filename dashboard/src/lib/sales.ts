// 매출 데이터 레이어.
//
// 현재: 목업 데이터를 생성해 반환합니다.
// 노션 연동 시(master.md §5.5): 노션 API 키는 브라우저에 노출 금지 →
//   가벼운 백엔드(BFF)가 노션 매출 DB를 조회해 SalesRecord[] 형태로 내려주고,
//   아래 USE_MOCK 를 false 로 바꾸면 fetch('/api/sales') 를 사용합니다.
//   (BFF 예시: server/notion-sales-bff.mjs, 설정: NOTION_SALES.md)

export interface SalesRecord {
  date: string; // "YYYY-MM-DD"
  amount: number; // 매출 금액(원)
}

const USE_MOCK = false;

export async function fetchSales(): Promise<SalesRecord[]> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 250));
    return generateMock();
  }
  const res = await fetch("/api/sales");
  if (!res.ok) throw new Error(`매출 데이터 조회 실패: ${res.status}`);
  return (await res.json()) as SalesRecord[];
}

// ───────── 목업 생성기 (작년 1/1 ~ 오늘) ─────────

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 결정적 의사난수 (0~1)
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function generateMock(): SalesRecord[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(today.getFullYear() - 1, 0, 1); // 작년 1월 1일
  const records: SalesRecord[] = [];

  const cursor = new Date(start);
  let dayIndex = 0;
  while (cursor <= today) {
    const dow = cursor.getDay();
    const month = cursor.getMonth();
    const weekendFactor = dow === 0 || dow === 6 ? 0.35 : 1;
    const seasonal = 1 + 0.15 * Math.sin(((month + 1) / 12) * 2 * Math.PI);
    const wobble = 0.8 + 0.4 * noise(dayIndex + 1);
    const yearGrowth = cursor.getFullYear() === today.getFullYear() ? 1.18 : 1.0;

    const base = 1_800_000;
    const amount =
      Math.round((base * weekendFactor * seasonal * wobble * yearGrowth) / 1000) *
      1000;

    records.push({ date: iso(cursor), amount });
    cursor.setDate(cursor.getDate() + 1);
    dayIndex += 1;
  }

  return records;
}
