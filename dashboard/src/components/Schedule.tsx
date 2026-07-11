import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  fetchSchedule,
  createEvent,
  updateEvent,
  deleteEvent,
  monthGrid,
  eventsByDay,
  ymKey,
  dayKey,
  timeLabel,
  fullWhen,
  toLocalInput,
  calColor,
  type ScheduleData,
  type SchedEvent,
  type EventInput,
} from "../lib/schedule";

const WD = ["일", "월", "화", "수", "목", "금", "토"];
const POLL_MS = 45_000;

export function Schedule() {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [data, setData] = useState<ScheduleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SchedEvent | null>(null);
  const [form, setForm] = useState<FormSeed | null>(null);
  const [busy, setBusy] = useState(false);
  // 캘린더(카테고리) 필터 — 숨긴 것 집합. 기본은 비어 있음(전체 표시).
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggleCal = (c: string) =>
    setHidden((prev) => {
      const n = new Set(prev);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });

  const days = useMemo(() => monthGrid(cursor), [cursor]);
  const rangeStart = days[0];
  const rangeEnd = days[days.length - 1];

  const load = useCallback(
    async (silent: boolean) => {
      if (!silent) setLoading(true);
      const to = new Date(rangeEnd);
      to.setHours(23, 59, 59);
      try {
        const d = await fetchSchedule(rangeStart, to);
        setData(d);
        setError(null);
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [rangeStart, rangeEnd]
  );

  useEffect(() => {
    load(false);
    const t = setInterval(() => load(true), POLL_MS); // 실시간 동기화(폴링)
    return () => clearInterval(t);
  }, [load]);

  const cals = data?.calendars ?? [];
  const editable = Boolean(data?.editable);
  const byDay = useMemo(() => eventsByDay(data?.events ?? []), [data]);
  const tKey = ymKey(new Date());
  const curMonth = cursor.getMonth();

  const move = (delta: number) =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  const goToday = () => {
    const n = new Date();
    setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
  };

  function openCreate(date: Date) {
    if (!editable) return;
    setSelected(null);
    setForm(seedCreate(cals, date));
  }
  function openEdit(ev: SchedEvent) {
    setSelected(null);
    setForm(seedEdit(ev));
  }

  async function handleSave(input: EventInput, eventId?: string) {
    setBusy(true);
    try {
      if (eventId) await updateEvent(eventId, input);
      else await createEvent(input);
      setForm(null);
      await load(true);
    } catch (e) {
      alert(`저장 실패: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(ev: SchedEvent) {
    if (!ev.eventId || !ev.calendarId) return;
    if (!confirm(`'${ev.title}' 일정을 삭제할까요?`)) return;
    setBusy(true);
    try {
      await deleteEvent(ev.eventId, ev.calendarId);
      setSelected(null);
      await load(true);
    } catch (e) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  if (data && !data.configured) {
    return (
      <section className="card card--wide">
        <h2 className="card__title">📅 구글캘린더 양방향 연동 설정 필요</h2>
        <p className="card__desc">{data.note}</p>
        <ol className="sched-setup">
          <li>구글 클라우드에서 <b>서비스 계정</b> 생성 + <b>JSON 키</b> 발급, Calendar API 사용 설정</li>
          <li>각 캘린더 <b>설정 및 공유</b> → 서비스계정 이메일을 <b>'변경 및 관리 권한'</b> 으로 추가</li>
          <li><code>.env</code> 에 <code>GOOGLE_SA_EMAIL</code>·<code>GOOGLE_SA_PRIVATE_KEY</code> 입력 후 BFF 재시작 (<code>GOOGLE_CALENDARS</code> 는 미리 채워둠)</li>
        </ol>
      </section>
    );
  }

  if (error) return <div className="state state--error">불러오기 실패: {error}</div>;

  return (
    <div className="cal">
      <div className="cal__toolbar">
        <div className="cal__nav">
          <button className="cal__navbtn" onClick={() => move(-1)} aria-label="이전 달">‹</button>
          <h2 className="cal__title">
            {cursor.getFullYear()}년 {cursor.getMonth() + 1}월
          </h2>
          <button className="cal__navbtn" onClick={() => move(1)} aria-label="다음 달">›</button>
          <button className="cal__today" onClick={goToday}>오늘</button>
          <button
            className="cal__refresh"
            onClick={() => load(false)}
            disabled={loading}
            aria-label="새로고침"
            title="새로고침"
          >
            <span className={loading ? "cal__refresh-spin" : ""}>↻</span>
            {loading ? " 불러오는 중…" : " 새로고침"}
          </button>
          {data?.fetchedAt && !loading && (
            <span className="cal__loading">
              {new Date(data.fetchedAt).toLocaleTimeString("ko-KR", {
                hour: "2-digit",
                minute: "2-digit",
              })} 기준
            </span>
          )}
        </div>
        <div className="cal__right">
          {cals.length > 0 && (
            <div className="cal__legend">
              {cals.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`cal__legend-item${hidden.has(c) ? " is-off" : ""}`}
                  onClick={() => toggleCal(c)}
                  title={hidden.has(c) ? "표시하기" : "숨기기"}
                >
                  <i className="dot" style={{ background: calColor(cals, c) }} />
                  {c}
                </button>
              ))}
              {hidden.size > 0 && (
                <button type="button" className="cal__legend-all" onClick={() => setHidden(new Set())}>
                  전체 보기
                </button>
              )}
            </div>
          )}
          {editable ? (
            <button className="cal__add" onClick={() => openCreate(new Date())}>
              + 일정 추가
            </button>
          ) : (
            <span className="cal__readonly">읽기 전용</span>
          )}
        </div>
      </div>

      <div className="cal__grid">
        {WD.map((w, i) => (
          <div key={w} className={`cal__wd${i === 0 ? " cal__wd--sun" : ""}${i === 6 ? " cal__wd--sat" : ""}`}>
            {w}
          </div>
        ))}

        {days.map((d) => {
          const key = ymKey(d);
          const evs = (byDay.get(key) ?? []).filter((e) => !(e.cal && hidden.has(e.cal)));
          const out = d.getMonth() !== curMonth;
          const isToday = key === tKey;
          const shown = evs.slice(0, 4);
          return (
            <div
              key={key}
              className={`cal__cell${out ? " cal__cell--out" : ""}${isToday ? " cal__cell--today" : ""}${editable ? " cal__cell--clickable" : ""}`}
              onClick={() => openCreate(d)}
            >
              <div className="cal__date">
                <span className={`cal__daynum${d.getDay() === 0 ? " is-sun" : ""}${d.getDay() === 6 ? " is-sat" : ""}${isToday ? " is-today" : ""}`}>
                  {d.getDate()}
                </span>
              </div>
              <div className="cal__evs">
                {shown.map((e) => (
                  <button
                    key={e.id}
                    className="cal__ev"
                    style={{ background: calColor(cals, e.cal) }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelected(e);
                    }}
                    title={e.title}
                  >
                    {!e.allDay && <span className="cal__ev-time">{timeLabel(e)}</span>}
                    <span className="cal__ev-title">{e.title}</span>
                  </button>
                ))}
                {evs.length > shown.length && (
                  <span className="cal__more">+{evs.length - shown.length}건</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <EventModal
          event={selected}
          cals={cals}
          editable={editable}
          busy={busy}
          onClose={() => setSelected(null)}
          onEdit={() => openEdit(selected)}
          onDelete={() => handleDelete(selected)}
        />
      )}

      {form && (
        <EventForm
          seed={form}
          cals={cals}
          busy={busy}
          onCancel={() => setForm(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// ===== 상세 모달 =====
function EventModal({
  event,
  cals,
  editable,
  busy,
  onClose,
  onEdit,
  onDelete,
}: {
  event: SchedEvent;
  cals: string[];
  editable: boolean;
  busy: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="modal__backdrop" onClick={onClose}>
      <div className="modal sched-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sched-modal__accent" style={{ background: calColor(cals, event.cal) }} />
        <div className="modal__head">
          <h3 className="modal__title">{event.title}</h3>
          <button className="modal__close" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="sched-modal__body">
          <dl className="sched-modal__row"><dt>🕒 일시</dt><dd>{fullWhen(event)}</dd></dl>
          {event.cal && (
            <dl className="sched-modal__row">
              <dt>📁 캘린더</dt>
              <dd><span className="dot" style={{ background: calColor(cals, event.cal), marginRight: 6 }} />{event.cal}</dd>
            </dl>
          )}
          {event.location && <dl className="sched-modal__row"><dt>📍 장소</dt><dd>{event.location}</dd></dl>}
          {event.description && <dl className="sched-modal__row"><dt>📝 세부내용</dt><dd className="sched-modal__desc">{event.description}</dd></dl>}
          {event.organizer && <dl className="sched-modal__row"><dt>👤 주최자</dt><dd>{event.organizer}</dd></dl>}
          {event.url && (
            <dl className="sched-modal__row"><dt>🔗 링크</dt><dd><a href={event.url} target="_blank" rel="noreferrer">구글 캘린더에서 열기</a></dd></dl>
          )}
        </div>
        {editable && event.eventId && (
          <div className="sched-modal__foot">
            <button className="btn-danger" onClick={onDelete} disabled={busy}>삭제</button>
            <button className="btn-primary" onClick={onEdit} disabled={busy}>수정</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== 생성/수정 폼 =====
interface FormSeed {
  eventId?: string;
  calendarId?: string;
  cal: string;
  title: string;
  allDay: boolean;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (포함)
  startTime: string; // datetime-local
  endTime: string;
  location: string;
  description: string;
}

function seedCreate(cals: string[], date: Date): FormSeed {
  const dk = ymKey(date);
  return {
    cal: cals[0] ?? "",
    title: "",
    allDay: true,
    startDate: dk,
    endDate: dk,
    startTime: `${dk}T09:00`,
    endTime: `${dk}T10:00`,
    location: "",
    description: "",
  };
}

function seedEdit(ev: SchedEvent): FormSeed {
  const sd = ev.start ? dayKey(ev.start) : ymKey(new Date());
  let ed = sd;
  if (ev.allDay && ev.end) {
    const inc = new Date(new Date(ev.end).getTime() - 86_400_000);
    ed = ymKey(inc);
    if (ed < sd) ed = sd;
  }
  return {
    eventId: ev.eventId,
    calendarId: ev.calendarId,
    cal: ev.cal ?? "",
    title: ev.title === "(제목 없음)" ? "" : ev.title,
    allDay: ev.allDay,
    startDate: sd,
    endDate: ed,
    startTime: ev.start && !ev.allDay ? toLocalInput(ev.start) : `${sd}T09:00`,
    endTime: ev.end && !ev.allDay ? toLocalInput(ev.end) : `${sd}T10:00`,
    location: ev.location ?? "",
    description: ev.description ?? "",
  };
}

function EventForm({
  seed,
  cals,
  busy,
  onCancel,
  onSave,
}: {
  seed: FormSeed;
  cals: string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (input: EventInput, eventId?: string) => void;
}) {
  const [f, setF] = useState<FormSeed>(seed);
  const set = (patch: Partial<FormSeed>) => setF((s) => ({ ...s, ...patch }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const input: EventInput = {
      cal: f.cal,
      calendarId: f.calendarId,
      title: f.title.trim() || "(제목 없음)",
      allDay: f.allDay,
      start: f.allDay ? f.startDate : f.startTime,
      end: f.allDay ? f.endDate : f.endTime,
      location: f.location.trim() || undefined,
      description: f.description.trim() || undefined,
    };
    onSave(input, f.eventId);
  }

  return (
    <div className="modal__backdrop" onClick={onCancel}>
      <form className="modal sched-form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal__head">
          <h3 className="modal__title">{f.eventId ? "일정 수정" : "일정 추가"}</h3>
          <button type="button" className="modal__close" onClick={onCancel} aria-label="닫기">✕</button>
        </div>

        <div className="sched-form__body">
          <label className="sched-form__field">
            <span>제목</span>
            <input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="일정 제목" autoFocus />
          </label>

          <label className="sched-form__field">
            <span>캘린더</span>
            <select value={f.cal} onChange={(e) => set({ cal: e.target.value })}>
              {cals.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <label className="sched-form__check">
            <input type="checkbox" checked={f.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
            종일
          </label>

          {f.allDay ? (
            <div className="sched-form__row2">
              <label className="sched-form__field"><span>시작</span>
                <input type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} />
              </label>
              <label className="sched-form__field"><span>종료</span>
                <input type="date" value={f.endDate} min={f.startDate} onChange={(e) => set({ endDate: e.target.value })} />
              </label>
            </div>
          ) : (
            <div className="sched-form__row2">
              <label className="sched-form__field"><span>시작</span>
                <input type="datetime-local" value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} />
              </label>
              <label className="sched-form__field"><span>종료</span>
                <input type="datetime-local" value={f.endTime} min={f.startTime} onChange={(e) => set({ endTime: e.target.value })} />
              </label>
            </div>
          )}

          <label className="sched-form__field">
            <span>장소</span>
            <input value={f.location} onChange={(e) => set({ location: e.target.value })} placeholder="(선택)" />
          </label>

          <label className="sched-form__field">
            <span>세부내용</span>
            <textarea value={f.description} onChange={(e) => set({ description: e.target.value })} rows={4} placeholder="(선택)" />
          </label>
        </div>

        <div className="sched-modal__foot">
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>취소</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
        </div>
      </form>
    </div>
  );
}
