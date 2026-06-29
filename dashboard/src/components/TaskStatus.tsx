import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchTasks,
  isDoneToday,
  STATUS_ORDER,
  type TaskRecord,
  type TaskStatus,
} from "../lib/tasks";

const REFRESH_MS = 5 * 60 * 1000; // 5분 자동 갱신

const STATUS_STYLE: Record<string, { fg: string; bg: string }> = {
  진행중: { fg: "#1d4ed8", bg: "#dbeafe" },
  업무대기: { fg: "#475569", bg: "#e2e8f0" },
  보류중: { fg: "#b45309", bg: "#fef3c7" },
  처리완료: { fg: "#047857", bg: "#d1fae5" },
};
const PRIORITY_STYLE: Record<string, { fg: string; bg: string }> = {
  높음: { fg: "#b91c1c", bg: "#fee2e2" },
  중간: { fg: "#b45309", bg: "#fef3c7" },
  낮음: { fg: "#475569", bg: "#e2e8f0" },
};

function Badge({ text, style }: { text: string; style?: { fg: string; bg: string } }) {
  const s = style ?? { fg: "#475569", bg: "#e2e8f0" };
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 12,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 999,
        color: s.fg,
        background: s.bg,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

export function TaskStatusView() {
  const [tasks, setTasks] = useState<TaskRecord[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "정체" | "전체">("전체");
  const [assignee, setAssignee] = useState<string>("전체");
  const [query, setQuery] = useState("");
  const timer = useRef<number | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const d = await fetchTasks();
      setTasks(d.tasks);
      setUpdatedAt(d.updatedAt);
      setError(null);
    } catch (e) {
      if (!silent) setError(String(e instanceof Error ? e.message : e));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    timer.current = window.setInterval(() => load(true), REFRESH_MS);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, []);

  // 집계
  const stats = useMemo(() => {
    const list = tasks ?? [];
    const byStatus: Record<string, number> = { 진행중: 0, 업무대기: 0, 보류중: 0, 처리완료: 0 };
    let doneToday = 0;
    let stale = 0;
    for (const t of list) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      if (isDoneToday(t)) doneToday += 1;
      if (t.stale) stale += 1;
    }
    return { byStatus, doneToday, stale, total: list.length };
  }, [tasks]);

  // 담당자별 집계
  const byAssignee = useMemo(() => {
    const map = new Map<
      string,
      { name: string; role: string | null; 진행중: number; 업무대기: number; 보류중: number; doneToday: number; stale: number; total: number }
    >();
    for (const t of tasks ?? []) {
      const key = t.assignee || "미지정";
      if (!map.has(key))
        map.set(key, { name: key, role: t.role, 진행중: 0, 업무대기: 0, 보류중: 0, doneToday: 0, stale: 0, total: 0 });
      const row = map.get(key)!;
      if (!row.role && t.role) row.role = t.role;
      if (t.status === "진행중") row.진행중 += 1;
      else if (t.status === "업무대기") row.업무대기 += 1;
      else if (t.status === "보류중") row.보류중 += 1;
      if (isDoneToday(t)) row.doneToday += 1;
      if (t.stale) row.stale += 1;
      row.total += 1;
    }
    return [...map.values()].sort((a, b) => b.진행중 + b.업무대기 + b.보류중 - (a.진행중 + a.업무대기 + a.보류중));
  }, [tasks]);

  const assignees = useMemo(
    () => ["전체", ...[...new Set((tasks ?? []).map((t) => t.assignee))].sort()],
    [tasks]
  );

  // 목록 필터
  const filtered = useMemo(() => {
    let list = tasks ?? [];
    if (statusFilter === "정체") list = list.filter((t) => t.stale);
    else if (statusFilter !== "전체") list = list.filter((t) => t.status === statusFilter);
    if (assignee !== "전체") list = list.filter((t) => t.assignee === assignee);
    const q = query.trim();
    if (q) list = list.filter((t) => (t.name + " " + t.content).includes(q));
    // 상태 우선순위 → 정체 → 업무일자 순 정렬
    const order: Record<string, number> = { 진행중: 0, 업무대기: 1, 보류중: 2, 처리완료: 3 };
    return [...list].sort((a, b) => {
      const so = (order[a.status] ?? 9) - (order[b.status] ?? 9);
      if (so) return so;
      if (a.stale !== b.stale) return a.stale ? -1 : 1;
      return (b.taskDate || "").localeCompare(a.taskDate || "");
    });
  }, [tasks, statusFilter, assignee, query]);

  if (error && !tasks) return <div className="state state--error">불러오기 실패: {error}</div>;
  if (!tasks) return <div className="state">업무현황을 불러오는 중…</div>;

  return (
    <div className="sales">
      <div className="sales__toolbar">
        <span className="sales__updated">
          {updatedAt ? `갱신 ${new Date(updatedAt).toLocaleString("ko-KR")}` : ""} · 5분마다 자동 갱신
        </span>
        <button className="sync-btn" onClick={() => load()} disabled={loading}>
          {loading ? "불러오는 중…" : "↻ 새로고침"}
        </button>
      </div>

      {error && <div className="state state--error">갱신 실패: {error}</div>}

      {/* 요약 KPI (클릭 → 목록 필터) */}
      <div className="sales__kpis">
        <Kpi label="진행 중" value={stats.byStatus["진행중"]} active={statusFilter === "진행중"} tone="#1d4ed8" onClick={() => setStatusFilter(statusFilter === "진행중" ? "전체" : "진행중")} />
        <Kpi label="업무 대기" value={stats.byStatus["업무대기"]} active={statusFilter === "업무대기"} onClick={() => setStatusFilter(statusFilter === "업무대기" ? "전체" : "업무대기")} />
        <Kpi label="보류 중" value={stats.byStatus["보류중"]} active={statusFilter === "보류중"} tone="#b45309" onClick={() => setStatusFilter(statusFilter === "보류중" ? "전체" : "보류중")} />
        <Kpi label="오늘 완료" value={stats.doneToday} tone="#047857" hint="금일 처리완료" />
        <Kpi label="정체 업무" value={stats.stale} active={statusFilter === "정체"} tone={stats.stale > 0 ? "#b91c1c" : undefined} hint="오래 멈춘 업무" onClick={() => setStatusFilter(statusFilter === "정체" ? "전체" : "정체")} />
      </div>

      {/* 담당자별 현황 */}
      <section className="card card--wide">
        <h2 className="card__title">담당자별 현황</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ tableLayout: "auto", minWidth: 560 }}>
            <thead>
              <tr>
                <th>담당자</th>
                <th style={{ textAlign: "right" }}>진행중</th>
                <th style={{ textAlign: "right" }}>대기</th>
                <th style={{ textAlign: "right" }}>보류</th>
                <th style={{ textAlign: "right" }}>오늘완료</th>
                <th style={{ textAlign: "right" }}>정체</th>
                <th style={{ textAlign: "right" }}>미완료계</th>
              </tr>
            </thead>
            <tbody>
              {byAssignee.map((r) => (
                <tr
                  key={r.name}
                  style={{ cursor: "pointer" }}
                  onClick={() => setAssignee(assignee === r.name ? "전체" : r.name)}
                >
                  <td style={{ fontWeight: 600 }}>
                    {r.name}
                    {r.role && <span className="muted" style={{ marginLeft: 6, fontWeight: 400 }}>{r.role}</span>}
                    {assignee === r.name && <span style={{ marginLeft: 6, color: "var(--brand)" }}>●</span>}
                  </td>
                  <Num n={r.진행중} color="#1d4ed8" />
                  <Num n={r.업무대기} />
                  <Num n={r.보류중} color="#b45309" />
                  <Num n={r.doneToday} color="#047857" />
                  <Num n={r.stale} color="#b91c1c" />
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{r.진행중 + r.업무대기 + r.보류중}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>행을 클릭하면 아래 목록이 해당 담당자로 필터됩니다.</p>
      </section>

      {/* 업무 목록 */}
      <section className="card card--wide">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <h2 className="card__title" style={{ margin: 0 }}>
            업무 목록 <span className="muted" style={{ fontWeight: 400 }}>({filtered.length}건)</span>
          </h2>
          <div style={{ flex: 1 }} />
          <select className="agent__select" style={{ width: "auto" }} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            {assignees.map((a) => (
              <option key={a} value={a}>{a === "전체" ? "담당자 전체" : a}</option>
            ))}
          </select>
          <select className="agent__select" style={{ width: "auto" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "정체" | "전체")}>
            <option value="전체">상태 전체</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
            <option value="정체">정체만</option>
          </select>
          <input
            className="login__input"
            style={{ width: 180, margin: 0 }}
            placeholder="업무명·내용 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {(statusFilter !== "전체" || assignee !== "전체" || query) && (
            <button className="sync-btn" onClick={() => { setStatusFilter("전체"); setAssignee("전체"); setQuery(""); }}>
              필터 해제
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="state">조건에 맞는 업무가 없습니다.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ tableLayout: "auto", minWidth: 720 }}>
              <thead>
                <tr>
                  <th>업무명</th>
                  <th>담당자</th>
                  <th>상태</th>
                  <th>우선순위</th>
                  <th>연관부서</th>
                  <th>업무일자</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <a href={t.url} target="_blank" rel="noreferrer" style={{ color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}>
                        {t.name}
                      </a>
                      {t.stale && <Badge text="정체" style={{ fg: "#b91c1c", bg: "#fee2e2" }} />}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{t.assignee}</td>
                    <td><Badge text={t.status} style={STATUS_STYLE[t.status]} /></td>
                    <td>{t.priority ? <Badge text={t.priority} style={PRIORITY_STYLE[t.priority]} /> : <span className="muted">—</span>}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{t.depts.length ? t.depts.join(", ") : "—"}</td>
                    <td className="muted" style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                      {t.status === "처리완료" ? (t.doneDate ? `완료 ${t.doneDate}` : "완료") : t.taskDate || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <section
      className={`metric${onClick ? " metric--btn" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      style={active ? { borderColor: "var(--brand)", boxShadow: "0 0 0 2px var(--brand) inset" } : undefined}
    >
      <div className="metric__label">{label}</div>
      <div className="metric__amount" style={{ color: tone }}>{value}건</div>
      {hint && <div className="metric__hint">{hint}</div>}
    </section>
  );
}

function Num({ n, color }: { n: number; color?: string }) {
  return (
    <td style={{ textAlign: "right", color: n > 0 ? color : "var(--muted)", fontWeight: n > 0 ? 700 : 400 }}>
      {n}
    </td>
  );
}
