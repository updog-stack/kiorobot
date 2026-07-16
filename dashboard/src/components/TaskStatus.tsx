import { Fragment, useEffect, useMemo, useState } from "react";
import {
  fetchTasks,
  fetchTaskSummary,
  getStaffLocations,
  setStaffLocation,
  busyLevel,
  STATUS_ORDER,
  todayIso,
  fetchCsDaySummary,
  wantsCsSummary,
  type CsDaySummaryResponse,
  type TaskRecord,
  type StaffLocations,
  type WorkLocation,
  type TaskSummaryResponse,
} from "../lib/tasks";

const REFRESH_MS = 5 * 60 * 1000;
const PALETTE = ["#5b6ad0", "#1aa39a", "#d99a3c", "#c96a99", "#4c8fdd", "#8b6fd0", "#d76b6b", "#5fa25a"];
// 업무분류 색상(미지정은 회보라)
const CAT_COLORS: Record<string, string> = { 개발업무: "#4c8fdd", 마케팅업무: "#c96a99", CS응대: "#1aa39a", 회계업무: "#d99a3c", 영업업무: "#5fa25a" };
const catColor = (c: string) => CAT_COLORS[c] ?? "#8b6fd0";
const STATUS_CLASS: Record<string, { fg: string; bg: string }> = {
  진행중: { fg: "#1d4ed8", bg: "#dbeafe" },
  업무대기: { fg: "#475569", bg: "#e2e8f0" },
  보류중: { fg: "#b45309", bg: "#fef3c7" },
  처리완료: { fg: "#047857", bg: "#d1fae5" },
};
// 다인아이앤씨 직원 4명만 구성원으로 표시(나머지는 타부서·거래처이므로 제외). master.md §2 참조
const TEAM = ["김동만", "민승재", "김소원", "조아름"];
// ISO(UTC) → 로컬 YYYY-MM-DD (오늘 활동 판단용)
const localDay = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// 오늘 활동 = 오늘 생성됐거나 오늘 수정된 업무
const touchedToday = (t: TaskRecord, today: string) =>
  localDay(t.created) === today || localDay(t.lastEdited) === today;
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
  const [catSel, setCatSel] = useState<string[]>([]); // 마인드맵에서 선택한 업무분류(표 필터)
  const [statusFilter, setStatusFilter] = useState<string | null>(null); // 표 상태 필터
  const [todayOnly, setTodayOnly] = useState(false); // 상태보드 '오늘만'(오늘 생성·수정)

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
    const list = (tasks ?? []).filter((t) => !t.trash);
    // 구성원 = 다인아이앤씨 직원 4명 고정(TEAM). 타부서·거래처는 담당/협업/요청으로 나와도 제외.
    return TEAM.map((name, i) => {
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

  // V2: 업무분류별 그룹(담당자·부서·건수)
  const byCategory = useMemo(() => {
    const list = (tasks ?? []).filter((t) => !t.trash);
    const m = new Map<string, { category: string; tasks: TaskRecord[]; assignees: Set<string>; depts: Set<string>; active: number }>();
    for (const t of list) {
      const c = t.category || "미분류";
      const g = m.get(c) ?? { category: c, tasks: [], assignees: new Set(), depts: new Set(), active: 0 };
      g.tasks.push(t);
      if (t.assignee && t.assignee !== "미지정") g.assignees.add(t.assignee);
      (t.depts ?? []).forEach((d) => g.depts.add(d));
      if (t.status !== "처리완료") g.active++;
      m.set(c, g);
    }
    return [...m.values()]
      .map((g) => ({ category: g.category, tasks: g.tasks, assignees: [...g.assignees], depts: [...g.depts], active: g.active }))
      .sort((a, b) => b.tasks.length - a.tasks.length);
  }, [tasks]);

  // V3: 상태별 그룹(칸반)
  const byStatus = useMemo(() => {
    const today = todayIso();
    const list = (tasks ?? []).filter((t) => !t.trash)
      .filter((t) => selected.length === 0 || selected.includes(t.assignee) || (t.collab ?? []).some((c) => selected.includes(c)) || (t.requester ? selected.includes(t.requester) : false))
      .filter((t) => catSel.length === 0 || catSel.includes(t.category || "미분류"))
      .filter((t) => !todayOnly || touchedToday(t, today));
    return STATUS_ORDER.map((s) => ({ status: s, tasks: list.filter((t) => (t.status || "업무대기") === s) }));
  }, [tasks, selected, catSel, todayOnly]);

  // '오늘만' 토글 버튼에 표시할 오늘 활동 건수(선택·분류 필터 무시, 전체 기준)
  const todayCount = useMemo(() => {
    const today = todayIso();
    return (tasks ?? []).filter((t) => !t.trash && touchedToday(t, today)).length;
  }, [tasks]);

  // 마인드맵 가지 — 허브(넓게 w1)→노드(좁게 w2)로 가늘어지는 유기적 곡선(채워진 path)
  const branch = (a: { x: number; y: number }, b: { x: number; y: number }, w1: number, w2: number) => {
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const px = -dy / L, py = dx / L;                          // 수직 단위벡터
    const cx = (a.x + b.x) / 2 + px * L * 0.13, cy = (a.y + b.y) / 2 + py * L * 0.13; // 제어점(자연스런 휨)
    const wm = (w1 + w2) / 2;
    const A1 = [a.x + px * w1 / 2, a.y + py * w1 / 2], A2 = [a.x - px * w1 / 2, a.y - py * w1 / 2];
    const B1 = [b.x + px * w2 / 2, b.y + py * w2 / 2], B2 = [b.x - px * w2 / 2, b.y - py * w2 / 2];
    const C1 = [cx + px * wm / 2, cy + py * wm / 2], C2 = [cx - px * wm / 2, cy - py * wm / 2];
    return `M${A1[0]},${A1[1]} Q${C1[0]},${C1[1]} ${B1[0]},${B1[1]} L${B2[0]},${B2[1]} Q${C2[0]},${C2[1]} ${A2[0]},${A2[1]} Z`;
  };

  // 복수 선택: selected는 이름 배열. 비어있으면 전체 표시.
  const isSel = (n: string) => selected.includes(n);
  // 클릭하면 토글(추가/해제) — 여러 명 동시 선택 가능
  const toggle = (n: string) => {
    setSelected((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]));
    setOpenTask(null);
  };
  const isCatSel = (c: string) => catSel.includes(c);
  const toggleCat = (c: string) => {
    setCatSel((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));
    setOpenTask(null);
  };
  const clearSel = () => { setSelected([]); setCatSel([]); setStatusFilter(null); setOpenTask(null); };
  const anyFilter = selected.length > 0 || catSel.length > 0 || !!statusFilter;

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

  // 표 필터 — 사람(담당/협업/요청) + 업무분류(마인드맵 선택) + 상태
  const shownTasks = tasks.filter((t) => {
    if (selected.length > 0 && !(isSel(t.assignee) || (t.collab ?? []).some(isSel) || (t.requester ? isSel(t.requester) : false))) return false;
    if (catSel.length > 0 && !catSel.includes(t.category || "미분류")) return false;
    if (statusFilter && (t.status || "업무대기") !== statusFilter) return false;
    return true;
  });

  return (
    <div className="sales" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ===== AI 한눈 요약 ===== */}
      <TaskAiSummary tasks={tasks} todayOnly={todayOnly} onToggleToday={() => setTodayOnly((v) => !v)} todayCount={todayCount} />

      {/* ===== 관계도 + 구성원 ===== */}
      <div className="task-top">
        {/* 관계도 */}
        <section className="card">
          <h2 className="card__title">팀 현황 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· 담당자·업무분류를 클릭하면 아래 업무표가 필터됩니다</span></h2>

          <div className="task-merge">
            {/* 마인드맵 (좌) */}
            <div className="task-merge__diagram">

          {/* ===== 업무분류·부서 중심 마인드맵 (항상 표시) ===== */}
          {(() => {
            const CX2 = 380, CY2 = 232, HUB2 = { x: CX2, y: CY2 };
            const cats = byCategory;
            const cpos = cats.map((_, i) => {
              const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(cats.length, 1);
              return { x: CX2 + Math.cos(a) * 172, y: CY2 + Math.sin(a) * 138 };
            });
            return (
              <>
                <svg viewBox="120 37 520 420" style={{ width: "100%", height: "auto", display: "block" }}>
                  <defs>
                    <filter id="nsh2" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1" stdDeviation="2.4" floodColor="#0b1020" floodOpacity={0.16} /></filter>
                  </defs>
                  {cats.map((g, i) => <path key={"cb" + i} d={branch(HUB2, cpos[i], 15, 4)} fill={catColor(g.category)} opacity={0.82} filter="url(#nsh2)" />)}
                  <g>
                    <circle cx={HUB2.x} cy={HUB2.y} r={32} fill="#eef1ff" stroke="#c9cef0" strokeWidth={2} filter="url(#nsh2)" />
                    <text x={HUB2.x} y={HUB2.y - 1} textAnchor="middle" fontSize={14} fontWeight={700} fill="#4f46e5">업무 분류</text>
                    <text x={HUB2.x} y={HUB2.y + 14} textAnchor="middle" fontSize={11} fill="#98a0c0">{cats.length}종 · {(tasks ?? []).filter((t) => !t.trash).length}건</text>
                  </g>
                  {cats.map((g, i) => {
                    const P = cpos[i], c = catColor(g.category), W = 148, H = 46;
                    return (
                      <g key={"cn" + i} opacity={catSel.length === 0 || isCatSel(g.category) ? 1 : 0.42}>
                        <rect x={P.x - W / 2} y={P.y - H / 2} width={W} height={H} rx={13} fill={isCatSel(g.category) ? c : "#fff"} stroke={c} strokeWidth={isCatSel(g.category) ? 3 : 2.2} filter="url(#nsh2)"
                          onClick={() => toggleCat(g.category)} style={{ cursor: "pointer" }} />
                        <text x={P.x} y={P.y - 2} textAnchor="middle" fontSize={14} fontWeight={700} fill={isCatSel(g.category) ? "#fff" : c} style={{ pointerEvents: "none" }}>{g.category}</text>
                        <text x={P.x} y={P.y + 14} textAnchor="middle" fontSize={11.5} fill={isCatSel(g.category) ? "rgba(255,255,255,0.88)" : "#8a92a0"} style={{ pointerEvents: "none" }}>총 {g.tasks.length} · 진행 {g.active}</text>
                      </g>
                    );
                  })}
                </svg>
                <div className="task-legend"><span>업무분류 박스 클릭 → 아래 업무표가 그 분류만 필터</span></div>
              </>
            );
          })()}
            </div>

            {/* 연결선 (마인드맵 → 업무표) */}
            <div className="task-merge__link" aria-hidden>
              <svg width="34" height="40" viewBox="0 0 34 40" preserveAspectRatio="none">
                <path d="M0,20 C14,20 20,20 34,20" stroke="#b7bde8" strokeWidth="3" fill="none" strokeLinecap="round" />
                <circle cx="2" cy="20" r="3.2" fill="#b7bde8" />
                <circle cx="32" cy="20" r="3.2" fill="#b7bde8" />
              </svg>
            </div>

            {/* 업무현황표 (오른쪽) */}
            <div className="task-merge__table">
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <h2 className="card__title" style={{ margin: 0 }}>업무현황표</h2>
                <div className="seg" style={{ marginLeft: 4 }}>
                  <button className={!statusFilter ? "is-active" : ""} onClick={() => setStatusFilter(null)}>전체</button>
                  {STATUS_ORDER.map((s) => (
                    <button key={s} className={statusFilter === s ? "is-active" : ""} onClick={() => setStatusFilter(statusFilter === s ? null : s)}>{s}</button>
                  ))}
                </div>
                <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
                  {[selected.length ? selected.join(", ") : "", catSel.length ? catSel.join(", ") : "", statusFilter ?? ""].filter(Boolean).join(" · ")}
                  {anyFilter ? ` → ${shownTasks.length}건` : `전체 ${tasks.length}건 · 담당자/업무분류 클릭하면 필터`}
                </span>
                {anyFilter && <button className="sync-btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={clearSel}>필터 해제</button>}
              </div>
              <div style={{ overflowX: "auto", maxHeight: 470, overflowY: "auto" }}>
                <table className="data-table" style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th style={{ width: "42%" }}>업무</th>
                      <th style={{ width: "42%" }}>요청 → 담당 · 협업</th>
                      <th>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownTasks.length === 0 && (
                      <tr><td colSpan={3} className="muted" style={{ textAlign: "center", padding: 18 }}>조건에 맞는 업무가 없습니다.</td></tr>
                    )}
                    {shownTasks.map((t) => {
                      const st = STATUS_CLASS[t.status] ?? { fg: "#475569", bg: "#e2e8f0" };
                      const open = openTask === t.id;
                      return (
                        <Fragment key={t.id}>
                          <tr style={{ cursor: "pointer", background: open ? "#f7f8fd" : undefined }} onClick={() => setOpenTask(open ? null : t.id)}>
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
                          </tr>
                          {open && (
                            <tr>
                              <td colSpan={3} style={{ background: "#f7f8fd", fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                                <b>업무내용</b> · {t.category || "분류 없음"}
                                {t.taskDate ? ` · 업무일 ${t.taskDate}` : ""}
                                {"\n"}
                                {t.content?.trim() || "(작성된 업무내용이 없습니다)"}
                                {t.url && (<>{"\n"}<a href={t.url} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>노션에서 열기 ↗</a></>)}
                                {wantsCsSummary(t.content) && t.assignee && t.assignee !== "미지정" && (
                                  <CsSummaryPanel assignee={t.assignee} date={t.taskDate || todayIso()} />
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
            </div>
          </div>
        </section>
      </div>

      {/* ===== 상태 보드 (팀 현황 아래 별도) ===== */}
      <section className="card card--wide">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <h2 className="card__title" style={{ margin: 0 }}>구성원 · 상태 보드 <span className="muted" style={{ fontWeight: 400, fontSize: 12.5 }}>· 이름 클릭하면 그 사람 업무만(기본 전체) · 대기→진행→보류→완료</span></h2>
          <button
            onClick={() => setTodayOnly((v) => !v)}
            style={{
              cursor: "pointer", fontSize: 13, fontWeight: 700,
              padding: "6px 12px", borderRadius: 999, whiteSpace: "nowrap",
              border: todayOnly ? "1px solid #4338ca" : "1px solid var(--border)",
              background: todayOnly ? "#4338ca" : "#fff",
              color: todayOnly ? "#fff" : "#475569",
            }}
            title="오늘 생성됐거나 오늘 수정된 업무만 보기"
          >
            📅 오늘만 {todayCount > 0 && `(${todayCount})`}
          </button>
        </div>

        {/* 구성원별 현황 (필터) — 이름 클릭하면 보드·표가 그 사람 업무만, 전체보기로 복귀 */}
        <div style={{ display: "flex", gap: 12, alignItems: "stretch", marginBottom: 16 }}>
          <button
            onClick={() => { setSelected([]); setOpenTask(null); }}
            title="전체 구성원 업무 보기(기본)"
            style={{
              flex: "0 0 auto", cursor: "pointer", fontSize: 14, fontWeight: 700,
              padding: "0 18px", borderRadius: 12, whiteSpace: "nowrap",
              border: selected.length === 0 ? "1px solid #4338ca" : "1px solid var(--border)",
              background: selected.length === 0 ? "#4338ca" : "#fff",
              color: selected.length === 0 ? "#fff" : "#475569",
            }}
          >
            👥 전체보기
          </button>
          <div className="member-row" style={{ flex: 1, marginBottom: 0 }}>
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
                  <span className="busy-badge" style={{ color: bl.color, background: bl.bg, marginTop: 4 }} title="진행 중 담당 업무량 기준 자동 판단">{bl.label}</span>
                </div>
                <div className="pcard__cnts">
                  <div><div className="pcard__n">{p.owned}</div><div className="pcard__l">담당</div></div>
                  <div><div className="pcard__n">{p.collab}</div><div className="pcard__l">협업</div></div>
                  <div><div className="pcard__n">{p.requested}</div><div className="pcard__l">요청</div></div>
                </div>
                <button className="loc-btn" onClick={() => toggleLoc(p.name)} title="클릭하면 내근↔외근 변경"
                  style={{ color: here ? "#0369a1" : "#c2410c", background: here ? "#e0f2fe" : "#ffedd5" }}>
                  {here ? "🏢 내근" : "🚗 외근"}
                </button>
              </div>
            );
          })}
          </div>
        </div>

        <div className="task-board">
          {byStatus.map(({ status, tasks: ts }) => {
            const sc = STATUS_CLASS[status] ?? { fg: "#475569", bg: "#e2e8f0" };
            return (
              <div key={status} className="task-col">
                <div className="task-col__h" style={{ color: sc.fg, background: sc.bg }}>{status}<b>{ts.length}</b></div>
                <div className="task-col__body">
                  {ts.map((t) => (
                    <div key={t.id} className={`task-card2${openTask === t.id ? " is-open" : ""}`} onClick={() => setOpenTask(openTask === t.id ? null : t.id)}>
                      <div className="task-card2__n">{t.stale && t.status !== "처리완료" && <span className="task-card2__stale" title="정체">●</span>}{t.name}</div>
                      <div className="task-card2__meta">
                        {t.assignee && t.assignee !== "미지정" && (
                          <span className="task-chip" onClick={(e) => { e.stopPropagation(); toggle(t.assignee); }} style={{ cursor: "pointer" }}>
                            <span className="task-chip__dot" style={{ background: colorOf(t.assignee) ?? "#b6bcc6" }}>{initial(t.assignee)}</span>{t.assignee}
                          </span>
                        )}
                        {t.category && <span className="task-tag" style={{ color: catColor(t.category), borderColor: catColor(t.category) }}>{t.category}</span>}
                        {(t.depts ?? []).map((d) => <span key={d} className="task-tag task-tag--muted">{d}</span>)}
                      </div>
                    </div>
                  ))}
                  {ts.length === 0 && <div className="task-col__empty">—</div>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

    </div>
  );
}

// 업무현황 맨 위 — Claude가 현재 업무 데이터를 읽고 만든 '한눈에' 요약
function TaskAiSummary({ tasks, todayOnly, onToggleToday, todayCount }: {
  tasks: TaskRecord[] | null;
  todayOnly: boolean;
  onToggleToday: () => void;
  todayCount: number;
}) {
  const [data, setData] = useState<TaskSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // 상태별 건수(색상 타일) — AI 요약과 무관하게 즉시 표시. '오늘만'이면 오늘 활동분만 집계
  const statusCounts = useMemo(() => {
    const today = todayIso();
    const list = (tasks ?? []).filter((t) => !t.trash).filter((t) => !todayOnly || touchedToday(t, today));
    return STATUS_ORDER.map((st) => ({
      status: st,
      n: list.filter((t) => (t.status || "업무대기") === st).length,
    }));
  }, [tasks, todayOnly]);
  const totalCnt = statusCounts.reduce((a, b) => a + b.n, 0);

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
          onClick={() => load(true)}
          disabled={loading}
        >
          {loading ? "요약 중…" : "🔄 다시 요약"}
        </button>
        <button
          onClick={onToggleToday}
          style={{
            cursor: "pointer", fontSize: 13, fontWeight: 700,
            padding: "6px 12px", borderRadius: 999, whiteSpace: "nowrap",
            border: todayOnly ? "1px solid #4338ca" : "1px solid var(--border)",
            background: todayOnly ? "#4338ca" : "#fff",
            color: todayOnly ? "#fff" : "#475569",
          }}
          title="오늘 생성됐거나 오늘 수정된 업무만 보기"
        >
          📅 오늘만 {todayCount > 0 && `(${todayCount})`}
        </button>
      </div>

      {/* 상태별 건수 — 한눈에 들어오는 색상 타일 */}
      {totalCnt > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10, margin: "4px 0 14px" }}>
          {statusCounts.map(({ status, n }) => {
            const c = STATUS_CLASS[status] ?? { fg: "#475569", bg: "#e2e8f0" };
            return (
              <div key={status} style={{ background: c.bg, borderRadius: 12, padding: "12px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 30, fontWeight: 800, color: c.fg, lineHeight: 1.05 }}>{n}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: c.fg, marginTop: 3 }}>{status}</div>
              </div>
            );
          })}
        </div>
      )}

      {loading && !s && <div className="state" style={{ background: "transparent" }}>업무 데이터를 읽는 중…</div>}
      {err && <div className="state state--error">{err}</div>}
      {!loading && !s && !err && data?.error && (
        <div className="state" style={{ background: "transparent", fontSize: 13 }}>{data.error}</div>
      )}

      {s && (
        <>
          <p style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.55, margin: "0 0 12px", color: "#4338ca" }}>
            {s.headline}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
            {s.highlights.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", borderLeft: "4px solid #6366f1" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#3730a3", marginBottom: 8 }}>📌 지금 주목</div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7 }}>
                  {s.highlights.map((h, i) => <li key={i} style={{ fontSize: 13.5, lineHeight: 1.5 }}>{h}</li>)}
                </ul>
              </div>
            )}
            {s.attention.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", borderLeft: "4px solid #ef4444" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#b91c1c", marginBottom: 8 }}>⚠️ 신경 쓸 것</div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7 }}>
                  {s.attention.map((a, i) => <li key={i} style={{ fontSize: 13.5, lineHeight: 1.5 }}>{a}</li>)}
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

// 업무내용에 '채널톡 참고' 표시가 있을 때, 담당자의 그날 채널톡 상담을 불러와 매장·내용 요약(영업폰은 수기)
function CsSummaryPanel({ assignee, date }: { assignee: string; date: string }) {
  const [data, setData] = useState<CsDaySummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(force = false) {
    setLoading(true);
    setErr(null);
    try {
      setData(await fetchCsDaySummary(assignee, date, force));
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 12, padding: 12, background: "#fff", border: "1px solid #dbe2f1", borderRadius: 10, whiteSpace: "normal" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <b style={{ color: "#1e40af" }}>💬 채널톡 상담 요약</b>
        <span className="muted" style={{ fontSize: 12 }}>{assignee} · {date} · 영업폰 인입은 수기 작성</span>
        <button
          onClick={() => load(!!data)}
          disabled={loading}
          style={{ marginLeft: "auto", cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "5px 11px", borderRadius: 8, border: "1px solid #4338ca", background: data ? "#fff" : "#4338ca", color: data ? "#4338ca" : "#fff" }}
        >
          {loading ? "불러오는 중…" : data ? "🔄 다시 요약" : "채널톡 상담 불러오기"}
        </button>
      </div>

      {err && <div style={{ color: "#b91c1c", fontSize: 13, marginTop: 8 }}>{err}</div>}

      {data && !loading && (
        <div style={{ marginTop: 10 }}>
          {data.error && <div style={{ color: "#b45309", fontSize: 13 }}>{data.error}</div>}
          {!data.error && data.count === 0 && (
            <div className="muted" style={{ fontSize: 13 }}>{data.note || "해당 날짜의 채널톡 상담 기록이 없습니다."}</div>
          )}
          {data.count > 0 && (
            <>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>상담 {data.count}건{data.cached ? " · 캐시" : ""}</div>
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {data.items.map((it, i) => (
                  <li key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13.5, lineHeight: 1.5 }}>
                    <span style={{ flex: "0 0 auto", fontWeight: 700, color: it.store ? "#111827" : "#6b7280" }}>
                      {it.url ? <a href={it.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{it.label}</a> : it.label}
                    </span>
                    <span style={{ color: "#374151" }}>— {it.summary || "(요약 없음)"}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
