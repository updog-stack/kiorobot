import { Fragment, useEffect, useMemo, useState } from "react";
import {
  fetchTasks,
  fetchTaskSummary,
  getStaffLocations,
  setStaffLocation,
  busyLevel,
  type TaskRecord,
  type StaffLocations,
  type WorkLocation,
  type TaskSummaryResponse,
} from "../lib/tasks";

const REFRESH_MS = 5 * 60 * 1000;
const PALETTE = ["#5b6ad0", "#1aa39a", "#d99a3c", "#c96a99", "#4c8fdd", "#8b6fd0", "#d76b6b", "#5fa25a"];
const STATUS_CLASS: Record<string, { fg: string; bg: string }> = {
  진행중: { fg: "#1d4ed8", bg: "#dbeafe" },
  업무대기: { fg: "#475569", bg: "#e2e8f0" },
  보류중: { fg: "#b45309", bg: "#fef3c7" },
  처리완료: { fg: "#047857", bg: "#d1fae5" },
};
const initial = (name: string) => (name[0] === "김" ? name[1] || name[0] : name[0]);

interface Person {
  name: string;
  role: string | null;
  color: string;
  owned: number;
  collab: number;
  requested: number;
  activeOwned: number;
  stale: number;
}

export function TaskStatusView() {
  const [tasks, setTasks] = useState<TaskRecord[] | null>(null);
  const [loc, setLoc] = useState<StaffLocations>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(silent = false) {
    try {
      const [d, l] = await Promise.all([fetchTasks(), getStaffLocations().catch(() => ({}))]);
      setTasks(d.tasks);
      setLoc(l as StaffLocations);
      setError(null);
    } catch (e) {
      if (!silent) setError(String(e instanceof Error ? e.message : e));
    }
  }
  useEffect(() => {
    load();
    const t = window.setInterval(() => load(true), REFRESH_MS);
    return () => window.clearInterval(t);
  }, []);

  // 구성원 집계
  const people: Person[] = useMemo(() => {
    const list = tasks ?? [];
    const names = [...new Set(list.map((t) => t.assignee).filter((n) => n && n !== "미지정"))].sort();
    return names.map((name, i) => {
      const owned = list.filter((t) => t.assignee === name);
      const activeOwned = owned.filter((t) => t.status !== "처리완료");
      return {
        name,
        role: owned.find((t) => t.role)?.role ?? null,
        color: PALETTE[i % PALETTE.length],
        owned: owned.length,
        collab: list.filter((t) => t.collab?.includes(name)).length,
        requested: list.filter((t) => t.requester === name && t.assignee !== name).length,
        activeOwned: activeOwned.length,
        stale: activeOwned.filter((t) => t.stale).length,
      };
    });
  }, [tasks]);

  const externals = useMemo(
    () => [...new Set((tasks ?? []).flatMap((t) => t.ext ?? []))],
    [tasks]
  );

  // 관계 엣지 (공유 업무 수를 가중치 w로 누적 — 선 굵기에 반영)
  const edges = useMemo(() => {
    const list = tasks ?? [];
    type E = { a: string; b: string; w: number };
    const collabM = new Map<string, E>();
    const reqM = new Map<string, E>();
    const extM = new Map<string, E>();
    const bump = (m: Map<string, E>, k: string, a: string, b: string) => {
      const e = m.get(k) ?? { a, b, w: 0 };
      e.w++;
      m.set(k, e);
    };
    for (const t of list) {
      (t.collab ?? []).forEach((c) => {
        if (c !== t.assignee) bump(collabM, [t.assignee, c].sort().join("|c|"), t.assignee, c);
      });
      if (t.requester && t.requester !== t.assignee) bump(reqM, t.requester + ">" + t.assignee, t.requester, t.assignee);
      (t.ext ?? []).forEach((x) => bump(extM, t.assignee + "|e|" + x, t.assignee, x));
    }
    return { collab: [...collabM.values()], req: [...reqM.values()], ext: [...extM.values()] };
  }, [tasks]);

  // SVG 좌표 (중심 허브 → 방사형 마인드맵)
  const CX = 380, CY = 262;
  const HUB = { x: CX, y: CY };
  const pos = useMemo(() => {
    const p: Record<string, { x: number; y: number }> = {};
    people.forEach((pn, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(people.length, 1);
      p[pn.name] = { x: CX + Math.cos(a) * 150, y: CY + Math.sin(a) * 150 };
    });
    externals.forEach((x, i) => {
      const a = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / Math.max(externals.length, 1);
      p[x] = { x: CX + Math.cos(a) * 248, y: CY + Math.sin(a) * 168 };
    });
    return p;
  }, [people, externals]);

  // 노드 반경(현재 진행 부하로 크기), 곡선 경로(마인드맵 느낌)
  const nodeR = (name: string) => 16 + (people.find((p) => p.name === name)?.activeOwned ?? 0) * 1.5;
  const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    return `M${a.x},${a.y} Q${mx - dy * 0.14},${my + dx * 0.14} ${b.x},${b.y}`;
  };

  // 복수 선택: selected는 이름 배열. 비어있으면 전체 표시.
  const isSel = (n: string) => selected.includes(n);
  const connected = (name: string) =>
    selected.length === 0 ||
    isSel(name) ||
    [...edges.collab, ...edges.req, ...edges.ext].some(
      (e) => (e.a === name && isSel(e.b)) || (e.b === name && isSel(e.a))
    );
  const edgeVis = (e: { a: string; b: string }) => selected.length === 0 || isSel(e.a) || isSel(e.b);
  // 클릭하면 토글(추가/해제) — 여러 명 동시 선택 가능
  const toggle = (n: string) => {
    setSelected((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]));
    setOpenTask(null);
  };
  const clearSel = () => { setSelected([]); setOpenTask(null); };

  async function toggleLoc(name: string) {
    const next: WorkLocation = (loc[name] ?? "내근") === "내근" ? "외근" : "내근";
    setLoc((m) => ({ ...m, [name]: next })); // 낙관적 반영
    try { setLoc(await setStaffLocation(name, next)); } catch { load(true); }
  }

  if (error && !tasks) return <div className="state state--error">불러오기 실패: {error}</div>;
  if (!tasks) return <div className="state">업무 관계도를 불러오는 중…</div>;

  const colorOf = (n: string) => people.find((p) => p.name === n)?.color;
  const chip = (n: string) => {
    const c = colorOf(n);
    return (
      <span
        key={n}
        className="task-chip"
        onClick={(e) => { e.stopPropagation(); if (c) toggle(n); }}
        style={{ cursor: c ? "pointer" : "default" }}
      >
        <span className="task-chip__dot" style={{ background: c ?? "#b6bcc6" }}>{c ? initial(n) : "외"}</span>
        {n}
      </span>
    );
  };

  // 선택된 사람(복수)의 업무만 필터 — 담당/협업/요청 어느 쪽이든 걸리면 표시
  const shownTasks =
    selected.length === 0
      ? tasks
      : tasks.filter(
          (t) => isSel(t.assignee) || (t.collab ?? []).some(isSel) || (t.requester ? isSel(t.requester) : false)
        );

  return (
    <div className="sales" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ===== AI 한눈 요약 ===== */}
      <TaskAiSummary />

      {/* ===== 관계도 + 구성원 ===== */}
      <div className="task-top">
        {/* 관계도 */}
        <section className="card">
          <h2 className="card__title">팀 관계도 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· 사람을 클릭(여러 명 가능)하면 아래 표가 그 사람들 업무만</span></h2>
          <svg viewBox="0 0 760 548" style={{ width: "100%", height: 468, display: "block" }}>
            <defs>
              <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="#c99" />
              </marker>
              {/* 아주 은은한 그림자(가벼운 리프트) */}
              <filter id="nsh" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="1" stdDeviation="2.4" floodColor="#0b1020" floodOpacity={0.16} />
              </filter>
            </defs>

            {/* 허브 스포크 (얇고 담백하게) */}
            {people.map((pn) =>
              pos[pn.name] ? (
                <line key={"hub" + pn.name} x1={HUB.x} y1={HUB.y} x2={pos[pn.name].x} y2={pos[pn.name].y}
                  stroke="#e6e8f2" strokeWidth={1} opacity={connected(pn.name) ? 1 : 0.25} />
              ) : null
            )}

            {/* ext edges */}
            {edges.ext.map((e, i) =>
              pos[e.a] && pos[e.b] ? (
                <line key={"x" + i} x1={pos[e.a].x} y1={pos[e.a].y} x2={pos[e.b].x} y2={pos[e.b].y}
                  stroke="#e2e4ea" strokeWidth={1 + Math.min(e.w, 4) * 0.4} opacity={edgeVis(e) ? 1 : 0.15} />
              ) : null
            )}
            {/* collab edges (곡선 · 공유 업무수만큼 굵게) */}
            {edges.collab.map((e, i) =>
              pos[e.a] && pos[e.b] ? (
                <path key={"c" + i} d={curve(pos[e.a], pos[e.b])} fill="none" stroke="#b7bde8"
                  strokeWidth={1.4 + Math.min(e.w, 5) * 0.8} strokeLinecap="round" opacity={edgeVis(e) ? 0.9 : 0.12} />
              ) : null
            )}
            {/* requester edges (화살표 · 담백한 점선) */}
            {edges.req.map((e, i) => {
              if (!pos[e.a] || !pos[e.b]) return null;
              const dx = pos[e.b].x - pos[e.a].x, dy = pos[e.b].y - pos[e.a].y, L = Math.hypot(dx, dy) || 1;
              const rB = nodeR(e.b);
              return (
                <line key={"r" + i} x1={pos[e.a].x + (dx * (nodeR(e.a) + 6)) / L} y1={pos[e.a].y + (dy * (nodeR(e.a) + 6)) / L}
                  x2={pos[e.a].x + dx * (1 - (rB + 9) / L)} y2={pos[e.a].y + dy * (1 - (rB + 9) / L)}
                  stroke="#d6a6a3" strokeWidth={1.4 + Math.min(e.w, 4) * 0.5} strokeDasharray="4 4" markerEnd="url(#arr)"
                  opacity={edgeVis(e) ? 0.95 : 0.12} />
              );
            })}

            {/* external nodes */}
            {externals.map((x) =>
              pos[x] ? (
                <g key={x} opacity={selected.length === 0 || edges.ext.some((e) => (e.a === x || e.b === x) && (isSel(e.a) || isSel(e.b))) ? 1 : 0.15}>
                  <circle cx={pos[x].x} cy={pos[x].y} r={9} fill="#fff" stroke="#d1d5db" strokeWidth={1.5} />
                  <text x={pos[x].x} y={pos[x].y + 3.5} textAnchor="middle" fontSize={9} fill="#aab0b8">외</text>
                  <text x={pos[x].x} y={pos[x].y + 23} textAnchor="middle" fontSize={10.5} fontWeight={500} fill="#9aa0a8">{x}</text>
                </g>
              ) : null
            )}

            {/* 중심 허브 (플랫·미니멀) */}
            <g>
              <circle cx={HUB.x} cy={HUB.y} r={31} fill="#f5f6fb" stroke="#e2e4f0" strokeWidth={1.5} filter="url(#nsh)" />
              <text x={HUB.x} y={HUB.y - 1} textAnchor="middle" fontSize={13} fontWeight={700} fill="#4f46e5">우리 팀</text>
              <text x={HUB.x} y={HUB.y + 13} textAnchor="middle" fontSize={9.5} fill="#98a0c0">{people.length}명 · {tasks.length}건</text>
            </g>

            {/* people nodes */}
            {people.map((pn) => {
              if (!pos[pn.name]) return null;
              const P = pos[pn.name];
              const r = nodeR(pn.name);
              const on = connected(pn.name);
              const bl = busyLevel(pn.activeOwned, pn.stale);
              const warn = bl.label === "업무과부하" ? "#d76b6b" : bl.label === "바쁨" ? "#d99a3c" : null;
              return (
                <g key={pn.name} style={{ cursor: "pointer" }} opacity={on ? 1 : 0.24} onClick={() => toggle(pn.name)}>
                  {isSel(pn.name) && (
                    <circle cx={P.x} cy={P.y} r={r + 7} fill="none" stroke={pn.color} strokeWidth={1.5} strokeDasharray="3 3" />
                  )}
                  {/* 바쁨/과부하일 때만 은은한 경고 링 */}
                  {warn && <circle cx={P.x} cy={P.y} r={r + 3} fill="none" stroke={warn} strokeWidth={2} opacity={0.9} />}
                  {/* 본체 (플랫 + 흰 테두리로 선과 분리 + 은은한 그림자) */}
                  <circle cx={P.x} cy={P.y} r={r} fill={pn.color} stroke="#fff" strokeWidth={2.5} filter="url(#nsh)" />
                  <text x={P.x} y={P.y + 4.5} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff">{initial(pn.name)}</text>
                  {/* 정체 배지 */}
                  {pn.stale > 0 && (
                    <>
                      <circle cx={P.x + r - 1} cy={P.y - r + 1} r={8} fill="#e5484d" stroke="#fff" strokeWidth={1.5} />
                      <text x={P.x + r - 1} y={P.y - r + 4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff">{pn.stale}</text>
                    </>
                  )}
                  <text x={P.x} y={P.y + r + 16} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="#374151">{pn.name}</text>
                  <text x={P.x} y={P.y + r + 29} textAnchor="middle" fontSize={9.5} fill="#9ca3af">
                    {(pn.role ? pn.role + " · " : "") + "진행 " + pn.activeOwned}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="task-legend">
            <span><i style={{ borderTopColor: "#b7bde8", borderTopWidth: 3 }} />협업 (굵을수록 함께 한 업무 많음)</span>
            <span><i style={{ borderTopStyle: "dashed", borderTopColor: "#d6a6a3" }} />요청 → 담당</span>
            <span><i className="nd" />외부 (카드사·효성 등)</span>
            <span><span style={{ color: "#e5484d", fontWeight: 700 }}>●</span> 정체 수 · <span style={{ color: "#d99a3c", fontWeight: 700 }}>◯</span> 바쁨/과부하</span>
          </div>
        </section>

        {/* 구성원별 현황 */}
        <section className="card">
          <h2 className="card__title">구성원별 현황 <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>담당 / 협업 / 요청 · 근무 · 부하</span></h2>
          <div>
            {people.map((p) => {
              const bl = busyLevel(p.activeOwned, p.stale);
              const here = (loc[p.name] ?? "내근") === "내근";
              const sel = isSel(p.name);
              return (
                <div key={p.name} className={"pcard" + (sel ? " pcard--sel" : "")}>
                  <span className="pcard__av" style={{ background: p.color }} onClick={() => toggle(p.name)}>{initial(p.name)}</span>
                  <div onClick={() => toggle(p.name)} style={{ cursor: "pointer", minWidth: 0 }}>
                    <div className="pcard__nm">{p.name}</div>
                    <div className="pcard__rl">{p.role}</div>
                  </div>
                  <div className="pcard__cnts">
                    <div><div className="pcard__n">{p.owned}</div><div className="pcard__l">담당</div></div>
                    <div><div className="pcard__n">{p.collab}</div><div className="pcard__l">협업</div></div>
                    <div><div className="pcard__n">{p.requested}</div><div className="pcard__l">요청</div></div>
                  </div>
                  {/* 근무(내근/외근) — 클릭해서 변경 */}
                  <button
                    className="loc-btn"
                    onClick={() => toggleLoc(p.name)}
                    title="클릭하면 내근↔외근 변경"
                    style={{ color: here ? "#0369a1" : "#c2410c", background: here ? "#e0f2fe" : "#ffedd5" }}
                  >
                    {here ? "🏢 내근" : "🚗 외근"}
                  </button>
                  {/* 업무 부하(자동) */}
                  <span className="busy-badge" style={{ color: bl.color, background: bl.bg }} title="진행 중 담당 업무량 기준 자동 판단">
                    {bl.label}
                  </span>
                </div>
              );
            })}
          </div>
          {selected.length > 0 && (
            <button className="sync-btn" style={{ marginTop: 10 }} onClick={clearSel}>
              선택 해제 ({selected.length}명)
            </button>
          )}
        </section>
      </div>

      {/* ===== 업무현황표 ===== */}
      <section className="card card--wide">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <h2 className="card__title" style={{ margin: 0 }}>업무현황표</h2>
          <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
            {selected.length > 0
              ? `${selected.join(", ")} 관련 ${shownTasks.length}건 · 이름 다시 누르면 해제`
              : `전체 ${tasks.length}건 · 마인드맵/이름 클릭(여러 명 가능)하면 그 사람 업무만`}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ width: "32%" }}>업무</th>
                <th style={{ width: "34%" }}>요청 → 담당 · 협업</th>
                <th>상태</th>
                <th>우선순위</th>
              </tr>
            </thead>
            <tbody>
              {shownTasks.length === 0 && (
                <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 18 }}>선택한 사람의 업무가 없습니다.</td></tr>
              )}
              {shownTasks.map((t) => {
                const st = STATUS_CLASS[t.status] ?? { fg: "#475569", bg: "#e2e8f0" };
                const open = openTask === t.id;
                return (
                  <Fragment key={t.id}>
                    <tr
                      style={{ cursor: "pointer", background: open ? "#f7f8fd" : undefined }}
                      onClick={() => setOpenTask(open ? null : t.id)}
                    >
                      <td style={{ fontWeight: 600 }}>
                        {t.name}
                        {t.stale && <span className="busy-badge" style={{ color: "#b91c1c", background: "#fee2e2", marginLeft: 6 }}>정체</span>}
                        <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>{open ? "▲" : "▼"}</span>
                      </td>
                      <td>
                        {t.requester && t.requester !== t.assignee && (<>{chip(t.requester)}<span className="task-arrow">→</span></>)}
                        {chip(t.assignee)}
                        {(t.collab ?? []).map((c) => chip(c))}
                        {(t.ext ?? []).map((x) => chip(x))}
                      </td>
                      <td><span className="busy-badge" style={{ color: st.fg, background: st.bg }}>{t.status}</span></td>
                      <td className="muted" style={{ fontSize: 12 }}>{t.priority || "—"}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={4} style={{ background: "#f7f8fd", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                          <b>업무내용</b> · {t.category || "분류 없음"}
                          {t.taskDate ? ` · 업무일 ${t.taskDate}` : ""}
                          {"\n"}
                          {t.content?.trim() || "(작성된 업무내용이 없습니다)"}
                          {t.url && (
                            <>{"\n"}<a href={t.url} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>노션에서 열기 ↗</a></>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// 업무현황 맨 위 — Claude가 현재 업무 데이터를 읽고 만든 '한눈에' 요약
function TaskAiSummary() {
  const [data, setData] = useState<TaskSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load(force = false) {
    setLoading(true);
    setErr(null);
    try {
      setData(await fetchTaskSummary(force));
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const s = data?.summary;
  return (
    <section
      className="card card--wide"
      style={{
        background: "linear-gradient(135deg, #eef1ff 0%, #f6f4ff 100%)",
        border: "1px solid #dcdcff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <h2 className="card__title" style={{ margin: 0 }}>🧠 오늘의 업무 한눈 요약</h2>
        <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>Claude가 현재 업무 DB를 읽고 정리</span>
        <button
          className="sync-btn"
          style={{ marginLeft: "auto" }}
          onClick={() => load(true)}
          disabled={loading}
        >
          {loading ? "요약 중…" : "🔄 다시 요약"}
        </button>
      </div>

      {loading && !s && <div className="state" style={{ background: "transparent" }}>업무 데이터를 읽는 중…</div>}
      {err && <div className="state state--error">{err}</div>}
      {!loading && !s && !err && data?.error && (
        <div className="state" style={{ background: "transparent", fontSize: 13 }}>{data.error}</div>
      )}

      {s && (
        <>
          <p style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.6, margin: "2px 0 12px", color: "#1e1b4b" }}>
            {s.headline}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            {s.highlights.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#3730a3", marginBottom: 6 }}>📌 지금 주목</div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
                  {s.highlights.map((h, i) => <li key={i} style={{ fontSize: 13.5, lineHeight: 1.55 }}>{h}</li>)}
                </ul>
              </div>
            )}
            {s.attention.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#b91c1c", marginBottom: 6 }}>⚠️ 신경 쓸 것</div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
                  {s.attention.map((a, i) => <li key={i} style={{ fontSize: 13.5, lineHeight: 1.55 }}>{a}</li>)}
                </ul>
              </div>
            )}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
            {data?.counts && `전체 ${data.counts.total} · 진행 중 ${data.counts.active} · 정체 ${data.counts.stale}`}
            {data?.generatedAt && ` · ${new Date(data.generatedAt).toLocaleString("ko-KR")} 기준`}
            {data?.cached && " (캐시)"}
          </div>
        </>
      )}
    </section>
  );
}
