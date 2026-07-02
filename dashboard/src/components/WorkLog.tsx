import { useEffect, useState } from "react";
import {
  fetchWorklog,
  generateWorklog,
  saveWorklogNote,
  todayIso,
  type WorklogAssignee,
  type WorklogReport,
  type WorklogTaskLite,
} from "../lib/worklog";

export function WorkLog() {
  const [dates, setDates] = useState<string[]>([]);
  const [report, setReport] = useState<WorklogReport | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  // 직원 자유기입(직접 작성)
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  function applyResponse(r: {
    dates: string[];
    report?: WorklogReport | null;
    date?: string;
    exists?: boolean;
  }) {
    setDates(r.dates);
    setSelected(r.report?.date ?? r.date ?? null);
    setReport(r.report ?? null);
    setMissing(!r.exists);
    setNote(r.report?.note ?? "");
    setSavedNote(r.report?.note ?? "");
    setSavedAt(r.report?.noteUpdatedAt ?? null);
    setError(null);
  }

  async function load(date?: string) {
    setLoading(true);
    try {
      applyResponse(await fetchWorklog(date));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    try {
      applyResponse(await generateWorklog());
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveNote() {
    const date = selected ?? todayIso();
    setSaving(true);
    try {
      applyResponse(await saveWorklogNote(date, note));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  const activeDate = selected ?? todayIso();
  const noteDirty = note !== savedNote;

  if (loading && !report) return <div className="state">업무일지를 불러오는 중…</div>;

  return (
    <div className="sales">
      <div className="sales__toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {dates.length > 0 ? (
            <select
              className="agent__select"
              style={{ width: "auto" }}
              value={selected ?? ""}
              onChange={(e) => load(e.target.value)}
            >
              {dates.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          ) : (
            <span className="sales__updated">아직 생성된 일지가 없습니다.</span>
          )}
          <input
            type="date"
            className="agent__select"
            style={{ width: "auto" }}
            value={activeDate}
            onChange={(e) => e.target.value && load(e.target.value)}
            title="다른 날짜의 업무일지를 열거나 새로 작성"
          />
          {report && (
            <span className="sales__updated">
              {report.auto ? "자동(18:00)" : "수동"} · {new Date(report.generatedAt).toLocaleString("ko-KR")} 생성
            </span>
          )}
        </div>
        <button className="sync-btn" onClick={handleGenerate} disabled={generating}>
          {generating ? "생성 중…" : "📝 지금 생성"}
        </button>
      </div>

      <div className="state" style={{ fontSize: 13 }}>
        업무일지는 <b>언제든 직접 작성·저장</b>할 수 있습니다. 위 날짜를 바꾸면 지난 날짜를 열거나 새 날짜(예: 내일 업무일정)를 만들 수 있어요.
        매일 <b>오후 6시</b>에는 노션 업무 기준 자동 요약도 함께 만들어집니다. (직접 작성한 내용은 자동 요약이 갱신돼도 그대로 보존됩니다)
      </div>

      {/* 직원 자유기입 — 언제든 직접 작성 */}
      <section className="card card--wide">
        <h2 className="card__title">
          ✍️ 직접 작성 · <span style={{ fontWeight: 400 }}>{activeDate}</span>
        </h2>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={"오늘 한 일, 진행 상황, 내일/이후 업무일정 등을 자유롭게 기재하세요.\n예)\n- 오전: A거래처 견적 발송\n- 오후: B프로젝트 회의, 자료 정리\n- 내일: C 납품 준비"}
          rows={10}
          style={{
            width: "100%",
            boxSizing: "border-box",
            resize: "vertical",
            padding: "12px 14px",
            fontSize: 14,
            lineHeight: 1.7,
            fontFamily: "inherit",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg)",
            color: "var(--text)",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
          <button className="sync-btn" onClick={handleSaveNote} disabled={saving || !noteDirty}>
            {saving ? "저장 중…" : noteDirty ? "💾 저장" : "저장됨"}
          </button>
          {noteDirty && !saving && <span className="sales__updated">저장되지 않은 변경사항이 있습니다.</span>}
          {!noteDirty && savedAt && (
            <span className="sales__updated">마지막 저장 {new Date(savedAt).toLocaleString("ko-KR")}</span>
          )}
        </div>
      </section>

      {error && <div className="state state--error">{error}</div>}

      {missing && !report && (
        <div className="state">
          {selected ? `${selected} 일지가 없습니다.` : "오늘 일지가 아직 없습니다."} 위 "지금 생성"으로 바로 만들 수 있습니다.
        </div>
      )}

      {report && (
        <>
          {/* 요약 KPI */}
          <div className="sales__kpis">
            <Kpi label="오늘 완료" value={report.summary.doneToday} tone="#047857" />
            <Kpi label="진행 중" value={report.summary.inProgress} tone="#1d4ed8" />
            <Kpi label="보류 중" value={report.summary.onHold} tone="#b45309" />
            <Kpi label="업무 대기" value={report.summary.waiting} />
            <Kpi label="정체" value={report.summary.stale} tone={report.summary.stale > 0 ? "#b91c1c" : undefined} />
          </div>

          {/* AI 코멘트 */}
          {report.aiComment && (
            <section className="card card--wide">
              <h2 className="card__title">🧠 오늘 요약</h2>
              <p style={{ margin: 0, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--text)" }}>
                {report.aiComment}
              </p>
            </section>
          )}

          {/* 담당자별 */}
          <section className="card card--wide">
            <h2 className="card__title">담당자별 업무</h2>
            {report.assignees.length === 0 ? (
              <div className="state">기록된 업무가 없습니다.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {report.assignees.map((a) => (
                  <AssigneeBlock key={a.name} a={a} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function AssigneeBlock({ a }: { a: WorklogAssignee }) {
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
        {a.name}
        {a.role && <span className="muted" style={{ marginLeft: 6, fontWeight: 400, fontSize: 13 }}>{a.role}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
        <TaskGroup title="오늘 완료" color="#047857" items={a.done} />
        <TaskGroup title="진행 중" color="#1d4ed8" items={a.inProgress} />
        <TaskGroup title="보류" color="#b45309" items={a.onHold} />
        {a.staleItems.length > 0 && <TaskGroup title="정체" color="#b91c1c" items={a.staleItems} />}
      </div>
    </div>
  );
}

function TaskGroup({ title, color, items }: { title: string; color: string; items: WorklogTaskLite[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 6 }}>
        {title} <span style={{ opacity: 0.7 }}>{items.length}</span>
      </div>
      <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((t, i) => (
          <li key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>
            <a href={t.url} target="_blank" rel="noreferrer" style={{ color: "var(--text)", textDecoration: "none" }}>
              {t.name}
            </a>
            {t.priority === "높음" && <span style={{ color: "#b91c1c", marginLeft: 4, fontSize: 11 }}>●</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <section className="metric">
      <div className="metric__label">{label}</div>
      <div className="metric__amount" style={{ color: tone }}>{value}건</div>
    </section>
  );
}
