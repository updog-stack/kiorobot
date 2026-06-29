import { useEffect, useState } from "react";
import {
  fetchWorklog,
  generateWorklog,
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

  async function load(date?: string) {
    setLoading(true);
    try {
      const r = await fetchWorklog(date);
      setDates(r.dates);
      setSelected(r.report?.date ?? r.date ?? null);
      setReport(r.report ?? null);
      setMissing(!r.exists);
      setError(null);
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
      const r = await generateWorklog();
      setDates(r.dates);
      setSelected(r.report?.date ?? null);
      setReport(r.report ?? null);
      setMissing(false);
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setGenerating(false);
    }
  }

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
        매일 <b>오후 6시</b>에 자동으로 그날의 업무일지가 생성됩니다. (BFF 서버가 켜져 있어야 하며, 6시에 꺼져 있었으면 다음 구동 시 보완 생성됩니다)
      </div>

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
