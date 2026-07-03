import { Fragment, useEffect, useMemo, useState } from "react";
import {
  fetchTasks,
  getStaffLocations,
  setStaffLocation,
  busyLevel,
  type TaskRecord,
  type StaffLocations,
  type WorkLocation,
} from "../lib/tasks";

const REFRESH_MS = 5 * 60 * 1000;
const PALETTE = ["#3a45d1", "#0f766e", "#b7823a", "#7c3aad", "#c2410c", "#0369a1", "#be123c", "#4d7c0f"];
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
  const [selected, setSelected] = useState<string | null>(null);
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

  // 관계 엣지
  const edges = useMemo(() => {
    const list = tasks ?? [];
    const collab: { a: string; b: string }[] = [];
    const req: { a: string; b: string }[] = [];
    const ext: { a: string; b: string }[] = [];
    const seen = new Set<string>();
    for (const t of list) {
      (t.collab ?? []).forEach((c) => {
        if (c !== t.assignee) {
          const k = [t.assignee, c].sort().join("|c|");
          if (!seen.has(k)) { seen.add(k); collab.push({ a: t.assignee, b: c }); }
        }
      });
      if (t.requester && t.requester !== t.assignee) {
        const k = t.requester + ">" + t.assignee;
        if (!seen.has(k)) { seen.add(k); req.push({ a: t.requester, b: t.assignee }); }
      }
      (t.ext ?? []).forEach((x) => {
        const k = t.assignee + "|e|" + x;
        if (!seen.has(k)) { seen.add(k); ext.push({ a: t.assignee, b: x }); }
      });
    }
    return { collab, req, ext };
  }, [tasks]);

  // SVG 좌표
  const CX = 360, CY = 210;
  const pos = useMemo(() => {
    const p: Record<string, { x: number; y: number }> = {};
    people.forEach((pn, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(people.length, 1);
      p[pn.name] = { x: CX + Math.cos(a) * 118, y: CY + Math.sin(a) * 112 };
    });
    externals.forEach((x, i) => {
      const a = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / Math.max(externals.length, 1);
      p[x] = { x: CX + Math.cos(a) * 258, y: CY + Math.sin(a) * 150 };
    });
    return p;
  }, [people, externals]);

  const connected = (name: string) =>
    !selected ||
    name === selected ||
    [...edges.collab, ...edges.req, ...edges.ext].some(
      (e) => (e.a === name && e.b === selected) || (e.b === name && e.a === selected)
    );
  const edgeVis = (e: { a: string; b: string }) => !selected || e.a === selected || e.b === selected;
  const pick = (n: string | null) => { setSelected((s) => (s === n ? null : n)); setOpenTask(null); };

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
        onClick={(e) => { e.stopPropagation(); if (c) pick(n); }}
        style={{ cursor: c ? "pointer" : "default" }}
      >
        <span className="task-chip__dot" style={{ background: c ?? "#b6bcc6" }}>{c ? initial(n) : "외"}</span>
        {n}
      </span>
    );
  };

  return (
    <div className="sales" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ===== 관계도 + 구성원 ===== */}
      <div className="task-top">
        {/* 관계도 */}
        <section className="card">
          <h2 className="card__title">팀 관계도 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· 사람을 클릭하면 관련 업무만 강조</span></h2>
          <svg viewBox="0 0 720 430" style={{ width: "100%", height: 400, display: "block" }}>
            <defs>
              <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="#c98d8f" />
              </marker>
            </defs>
            {/* ext edges */}
            {edges.ext.map((e, i) =>
              pos[e.a] && pos[e.b] ? (
                <line key={"x" + i} x1={pos[e.a].x} y1={pos[e.a].y} x2={pos[e.b].x} y2={pos[e.b].y}
                  stroke="#d6d9de" strokeWidth={1.5} opacity={edgeVis(e) ? 0.9 : 0.12} />
              ) : null
            )}
            {/* collab edges */}
            {edges.collab.map((e, i) =>
              pos[e.a] && pos[e.b] ? (
                <line key={"c" + i} x1={pos[e.a].x} y1={pos[e.a].y} x2={pos[e.b].x} y2={pos[e.b].y}
                  stroke="#8a93d8" strokeWidth={3} strokeLinecap="round" opacity={edgeVis(e) ? 0.85 : 0.1} />
              ) : null
            )}
            {/* requester edges (arrow) */}
            {edges.req.map((e, i) => {
              if (!pos[e.a] || !pos[e.b]) return null;
              const dx = pos[e.b].x - pos[e.a].x, dy = pos[e.b].y - pos[e.a].y, L = Math.hypot(dx, dy) || 1;
              return (
                <line key={"r" + i} x1={pos[e.a].x + (dx * 26) / L} y1={pos[e.a].y + (dy * 26) / L}
                  x2={pos[e.a].x + dx * (1 - 30 / L)} y2={pos[e.a].y + dy * (1 - 30 / L)}
                  stroke="#c9564c" strokeWidth={2} strokeDasharray="5 4" markerEnd="url(#arr)"
                  opacity={edgeVis(e) ? 0.8 : 0.1} />
              );
            })}
            {/* external nodes */}
            {externals.map((x) =>
              pos[x] ? (
                <g key={x} opacity={!selected || edges.ext.some((e) => (e.a === x || e.b === x) && (e.a === selected || e.b === selected)) ? 1 : 0.18}>
                  <circle cx={pos[x].x} cy={pos[x].y} r={8} fill="#eef0f3" stroke="#c4c9d0" strokeWidth={1.5} />
                  <text x={pos[x].x} y={pos[x].y + 22} textAnchor="middle" fontSize={10.5} fill="#8d929a">{x}</text>
                </g>
              ) : null
            )}
            {/* people nodes */}
            {people.map((pn) => {
              if (!pos[pn.name]) return null;
              const r = 17 + pn.owned * 1.4;
              const on = connected(pn.name);
              return (
                <g key={pn.name} style={{ cursor: "pointer" }} opacity={on ? 1 : 0.25} onClick={() => pick(pn.name)}>
                  {selected === pn.name && (
                    <circle cx={pos[pn.name].x} cy={pos[pn.name].y} r={r + 6} fill="none" stroke={pn.color} strokeWidth={2} strokeDasharray="3 3" />
                  )}
                  <circle cx={pos[pn.name].x} cy={pos[pn.name].y} r={r} fill={pn.color} />
                  <text x={pos[pn.name].x} y={pos[pn.name].y + 4.5} textAnchor="middle" fontSize={12.5} fontWeight={800} fill="#fff">{initial(pn.name)}</text>
                  <text x={pos[pn.name].x} y={pos[pn.name].y + r + 15} textAnchor="middle" fontSize={11.5} fontWeight={700} fill="#3a3f47">{pn.name}</text>
                  <text x={pos[pn.name].x} y={pos[pn.name].y + r + 28} textAnchor="middle" fontSize={9.5} fill="#9aa0a8">{(pn.role || "") + " · 담당 " + pn.owned}</text>
                </g>
              );
            })}
          </svg>
          <div className="task-legend">
            <span><i style={{ borderTopColor: "#8a93d8" }} />협업 (담당↔협업)</span>
            <span><i style={{ borderTopStyle: "dashed", borderTopColor: "#c9564c" }} />요청 → 담당</span>
            <span><i className="nd" />외부 (카드사·효성 등)</span>
          </div>
        </section>

        {/* 구성원별 현황 */}
        <section className="card">
          <h2 className="card__title">구성원별 현황 <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>담당 / 협업 / 요청 · 근무 · 부하</span></h2>
          <div>
            {people.map((p) => {
              const bl = busyLevel(p.activeOwned, p.stale);
              const here = (loc[p.name] ?? "내근") === "내근";
              const isSel = selected === p.name;
              return (
                <div key={p.name} className={"pcard" + (isSel ? " pcard--sel" : "")}>
                  <span className="pcard__av" style={{ background: p.color }} onClick={() => pick(p.name)}>{initial(p.name)}</span>
                  <div onClick={() => pick(p.name)} style={{ cursor: "pointer", minWidth: 0 }}>
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
          {selected && (
            <button className="sync-btn" style={{ marginTop: 10 }} onClick={() => pick(null)}>선택 해제</button>
          )}
        </section>
      </div>

      {/* ===== 업무현황표 ===== */}
      <section className="card card--wide">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <h2 className="card__title" style={{ margin: 0 }}>업무현황표</h2>
          <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
            {selected ? `${selected} 관련 · 이름/행 클릭` : `전체 ${tasks.length}건 · 이름 클릭하면 필터, 행 클릭하면 내용`}
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
              {tasks.map((t) => {
                const rel = !selected || t.assignee === selected || t.collab?.includes(selected) || t.requester === selected;
                const st = STATUS_CLASS[t.status] ?? { fg: "#475569", bg: "#e2e8f0" };
                const open = openTask === t.id;
                return (
                  <Fragment key={t.id}>
                    <tr
                      style={{ opacity: rel ? 1 : 0.28, cursor: "pointer", background: open ? "#f7f8fd" : undefined }}
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
