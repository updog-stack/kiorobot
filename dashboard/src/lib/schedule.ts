// 구글캘린더 일정 (읽기 전용) 데이터 레이어.

export interface SchedEvent {
  id: string;
  eventId?: string; // 구글 이벤트 ID (수정/삭제용)
  calendarId?: string; // 구글 캘린더 ID
  title: string;
  cal?: string; // 캘린더 라벨 (여러 캘린더 구분용)
  start: string | null; // ISO datetime 또는 YYYY-MM-DD(종일)
  end: string | null;
  allDay: boolean;
  location: string | null;
  description?: string | null;
  organizer?: string | null;
  url: string | null;
}

export interface ScheduleData {
  configured: boolean;
  editable?: boolean; // 양방향(쓰기) 가능 여부
  calendar?: string;
  calendars?: string[];
  fetchedAt?: string;
  events: SchedEvent[];
  note?: string;
}

// 생성·수정 시 보내는 입력
export interface EventInput {
  cal: string; // 캘린더 라벨
  calendarId?: string; // 수정 시
  title: string;
  allDay: boolean;
  start: string; // 종일: YYYY-MM-DD, 시간: ISO/local
  end?: string;
  location?: string;
  description?: string;
}

export async function createEvent(input: EventInput): Promise<SchedEvent> {
  const res = await fetch("/api/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `생성 실패: ${res.status}`);
  return body as SchedEvent;
}

export async function updateEvent(
  eventId: string,
  input: EventInput
): Promise<SchedEvent> {
  const res = await fetch(`/api/schedule/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `수정 실패: ${res.status}`);
  return body as SchedEvent;
}

export async function deleteEvent(
  eventId: string,
  calendarId: string
): Promise<void> {
  const res = await fetch(
    `/api/schedule/${encodeURIComponent(eventId)}?calendarId=${encodeURIComponent(
      calendarId
    )}`,
    { method: "DELETE" }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `삭제 실패: ${res.status}`);
  }
}

// Date → datetime-local 입력값 (YYYY-MM-DDTHH:MM, 로컬)
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

// 캘린더 라벨 → 색상 (구분용 팔레트)
const CAL_COLORS = ["#2f5be0", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];
export function calColor(calendars: string[] | undefined, label?: string): string {
  if (!label || !calendars) return CAL_COLORS[0];
  const i = calendars.indexOf(label);
  return CAL_COLORS[i >= 0 ? i % CAL_COLORS.length : 0];
}

export async function fetchSchedule(
  from?: Date,
  to?: Date
): Promise<ScheduleData> {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from.toISOString());
  if (to) qs.set("to", to.toISOString());
  const url = qs.toString() ? `/api/schedule?${qs}` : "/api/schedule";
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `일정 조회 실패: ${res.status}`);
  return body as ScheduleData;
}

const WD = ["일", "월", "화", "수", "목", "금", "토"];

// 날짜 키(YYYY-MM-DD, 로컬)
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// "오늘" / "내일" / "M월 D일 (요일)"
export function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  const base = `${m}월 ${d}일 (${WD[date.getDay()]})`;
  if (diff === 0) return `오늘 · ${base}`;
  if (diff === 1) return `내일 · ${base}`;
  return base;
}

// 시간 표기: 종일 → "종일", 그 외 → "14:00" 또는 "14:00–15:30"
export function timeLabel(e: SchedEvent): string {
  if (e.allDay || !e.start) return "종일";
  const hm = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`;
  };
  const s = hm(e.start);
  if (!e.end) return s;
  // 종료가 시작과 같은 날이면 시간만, 다르면 시작만 표기
  if (dayKey(e.end) === dayKey(e.start)) return `${s}–${hm(e.end)}`;
  return s;
}

// 날짜별 그룹 (시작일 기준, 시간순 정렬된 입력 가정)
export function groupByDay(
  events: SchedEvent[]
): { key: string; label: string; events: SchedEvent[] }[] {
  const map = new Map<string, SchedEvent[]>();
  for (const e of events) {
    if (!e.start) continue;
    const k = dayKey(e.start);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(e);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, evs]) => ({ key, label: dayLabel(key), events: evs }));
}

// ===== 월간 캘린더 =====
export function ymKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// 월 그리드(일요일 시작, 6주=42칸) 날짜 배열
export function monthGrid(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay()); // 그 주 일요일로
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

// 한 일정이 차지하는 날짜 키들 (종일·다일 이벤트는 여러 날 점유)
export function eventDayKeys(e: SchedEvent): string[] {
  if (!e.start) return [];
  const start = new Date(e.start);
  if (!e.allDay) return [dayKey(e.start)];
  const endEx = e.end ? new Date(e.end) : new Date(start.getTime() + 86_400_000);
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(endEx.getFullYear(), endEx.getMonth(), endEx.getDate());
  const keys: string[] = [];
  while (cur < endDay) {
    keys.push(ymKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return keys.length ? keys : [ymKey(start)];
}

// dayKey → 그 날의 일정들 (정렬: 종일 먼저, 그다음 시간순)
export function eventsByDay(events: SchedEvent[]): Map<string, SchedEvent[]> {
  const map = new Map<string, SchedEvent[]>();
  for (const e of events) {
    for (const k of eventDayKeys(e)) {
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return (a.start ?? "").localeCompare(b.start ?? "");
    });
  }
  return map;
}

// 상세 모달용 날짜·시간 표기
export function fullWhen(e: SchedEvent): string {
  if (!e.start) return "";
  const s = new Date(e.start);
  const dstr = `${s.getFullYear()}년 ${s.getMonth() + 1}월 ${s.getDate()}일 (${
    WD[s.getDay()]
  })`;
  if (e.allDay) return `${dstr} · 종일`;
  const hm = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(
      2,
      "0"
    )}`;
  if (!e.end) return `${dstr} ${hm(s)}`;
  const en = new Date(e.end);
  return `${dstr} ${hm(s)}–${hm(en)}`;
}
