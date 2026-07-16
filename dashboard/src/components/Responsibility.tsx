import { useEffect, useMemo, useRef, useState } from "react";
import { fetchTasks, fetchResponsibilityAnalysis, type TaskRecord, type ResponsibilityResponse } from "../lib/tasks";

// 다인아이앤씨 직원 4명(업무현황과 동일 기준). master.md §2
const TEAM = ["김동만", "민승재", "김소원", "조아름"];

// ===== 그래프 데이터 모델 =====
type NodeType = "self" | "person" | "category" | "task" | "partner";
interface GNode { id: string; label: string; type: NodeType; sub?: string }
interface GEdge { source: string; target: string; kind: string }

const NODE_STYLE: Record<NodeType, { fill: string; r: number; text: string; font: number }> = {
  self: { fill: "#4338ca", r: 34, text: "#fff", font: 17 },
  person: { fill: "#3b82f6", r: 22, text: "#fff", font: 14 },
  category: { fill: "#f97316", r: 22, text: "#fff", font: 14 },
  task: { fill: "#e5e7eb", r: 11, text: "#374151", font: 13.5 },
  partner: { fill: "#10b981", r: 22, text: "#fff", font: 14 },
};
const LEGEND: { type: NodeType; label: string }[] = [
  { type: "self", label: "본인" },
  { type: "category", label: "담당업무(분류)" },
  { type: "task", label: "개별 업무" },
  { type: "person", label: "협업 직원" },
  { type: "partner", label: "거래처" },
];

const trunc = (s: string, n = 12) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function buildGraph(tasks: TaskRecord[], assignee: string): { nodes: GNode[]; edges: GEdge[] } {
  const mine = tasks.filter((t) => t.assignee === assignee && !t.trash);
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const seen = new Set<string>();
  const add = (n: GNode) => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n); } };

  add({ id: "self", label: assignee, type: "self" });
  const catOf = (t: TaskRecord) => t.category || "미분류";
  for (const c of [...new Set(mine.map(catOf))]) {
    add({ id: "cat:" + c, label: c, type: "category" });
    edges.push({ source: "self", target: "cat:" + c, kind: "cat" });
  }
  mine.forEach((t, i) => {
    const tid = "task:" + (t.id || i);
    add({ id: tid, label: t.name, type: "task", sub: t.status });
    edges.push({ source: "cat:" + catOf(t), target: tid, kind: "task" });
  });
  const collabs = new Set<string>();
  mine.forEach((t) => (t.collab || []).forEach((n) => collabs.add(n)));
  for (const n of collabs) { add({ id: "p:" + n, label: n, type: "person" }); edges.push({ source: "self", target: "p:" + n, kind: "collab" }); }
  const partners = new Set<string>();
  mine.forEach((t) => (t.ext || []).forEach((e) => partners.add(e)));
  for (const e of partners) { add({ id: "x:" + e, label: e, type: "partner" }); edges.push({ source: "self", target: "x:" + e, kind: "partner" }); }
  return { nodes, edges };
}

// 곡선 연결선(자연스러운 베지어)
function curvePath(ax: number, ay: number, bx: number, by: number) {
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const dx = bx - ax, dy = by - ay;
  const cx = mx - dy * 0.12, cy = my + dx * 0.12;
  return `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
}

const W = 1080, H = 780, CX = W / 2, CY = H / 2;

function NodeCircle({ n, x, y, cx = CX, onDown }: { n: GNode; x: number; y: number; cx?: number; onDown?: (e: React.MouseEvent) => void }) {
  const s = NODE_STYLE[n.type];
  const side = x >= cx ? 1 : -1; // 개별 업무 라벨을 바깥쪽으로 → 중앙 충돌·가장자리 잘림 방지
  return (
    <g transform={`translate(${x} ${y})`} style={{ cursor: onDown ? "grab" : "default" }} onMouseDown={onDown}>
      <circle r={s.r} fill={s.fill} stroke="#fff" strokeWidth={2.5} filter="url(#rgsh)" />
      {n.type === "task" && (
        <text x={side * (s.r + 6)} y={5} textAnchor={side > 0 ? "start" : "end"} fontSize={s.font} fill="#475569" style={{ pointerEvents: "none" }}>{trunc(n.label, 20)}</text>
      )}
      {n.type === "category" && (
        <text textAnchor="middle" y={s.r + 17} fontSize={13.5} fontWeight={800} fill="#9a3412" style={{ pointerEvents: "none" }}>{trunc(n.label, 10)}</text>
      )}
      {(n.type === "self" || n.type === "person" || n.type === "partner") && (
        <text textAnchor="middle" y={5} fontSize={s.font} fontWeight={700} fill={s.text} style={{ pointerEvents: "none" }}>{trunc(n.label, 6)}</text>
      )}
    </g>
  );
}

function Defs() {
  return (
    <defs>
      <filter id="rgsh" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="1.5" stdDeviation="2" floodColor="#1e293b" floodOpacity="0.18" />
      </filter>
    </defs>
  );
}

function Legend() {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, color: "#475569", marginTop: 8 }}>
      {LEGEND.map((l) => (
        <span key={l.type} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: NODE_STYLE[l.type].fill, display: "inline-block" }} />
          {l.label}
        </span>
      ))}
    </div>
  );
}

// ===== 방사형 SVG 그래프 =====
function RadialGraph({ nodes, edges }: { nodes: GNode[]; edges: GEdge[] }) {
  const pos = useMemo(() => {
    const p = new Map<string, { x: number; y: number }>();
    p.set("self", { x: CX, y: CY });
    const ring = nodes.filter((n) => n.type === "category" || n.type === "person" || n.type === "partner");
    // 담당업무(분류)는 위쪽 반원, 협업(직원+거래처)은 아래쪽 반원에 배치
    const cats = ring.filter((n) => n.type === "category");
    const collabs = ring.filter((n) => n.type !== "category");
    const R1 = 232;
    const place = (list: GNode[], a0: number, a1: number) => {
      list.forEach((n, i) => {
        const t = list.length === 1 ? 0.5 : i / (list.length - 1);
        const a = a0 + (a1 - a0) * t;
        p.set(n.id, { x: CX + Math.cos(a) * R1, y: CY + Math.sin(a) * R1 });
      });
    };
    place(cats, -Math.PI * 0.97, -Math.PI * 0.03);      // 위쪽 호(거의 반원 전체)
    place(collabs, Math.PI * 0.13, Math.PI * 0.87);       // 아래쪽 호
    // 각 분류의 개별 업무: 분류 노드 각도 근처로 부채꼴 배치(바깥 링)
    const R2 = 372;
    for (const c of cats) {
      const cp = p.get(c.id)!;
      const base = Math.atan2(cp.y - CY, cp.x - CX);
      const tasks = edges.filter((e) => e.source === c.id).map((e) => e.target);
      tasks.forEach((tid, j) => {
        const spread = tasks.length > 3 ? 0.15 : 0.2;
        const a = base + spread * (j - (tasks.length - 1) / 2);
        p.set(tid, { x: CX + Math.cos(a) * R2, y: CY + Math.sin(a) * R2 });
      });
    }
    return p;
  }, [nodes, edges]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", maxHeight: 540 }}>
      <Defs />
      {edges.map((e, i) => {
        const a = pos.get(e.source), b = pos.get(e.target);
        if (!a || !b) return null;
        return <path key={i} d={curvePath(a.x, a.y, b.x, b.y)} fill="none" stroke={e.kind === "task" ? "#e2e8f0" : "#cbd5e1"} strokeWidth={e.kind === "task" ? 1.4 : 2.4} />;
      })}
      {nodes.map((n) => { const q = pos.get(n.id); return q ? <NodeCircle key={n.id} n={n} x={q.x} y={q.y} /> : null; })}
    </svg>
  );
}

// ===== 네트워크(force-directed) 그래프 — 가로로 넓은 캔버스(좌우 여백 최소화) =====
const NW = 1480, NH = 600, NCX = NW / 2, NCY = NH / 2;
function NetworkGraph({ nodes, edges }: { nodes: GNode[]; edges: GEdge[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const posRef = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(new Map());
  const dragRef = useRef<string | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const m = new Map<string, { x: number; y: number; vx: number; vy: number }>();
    // 가로로 넓은 타원에 초기 배치
    nodes.forEach((n, i) => {
      const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      m.set(n.id, { x: NCX + Math.cos(a) * 460 + ((i % 3) - 1) * 14, y: NCY + Math.sin(a) * 190 + ((i % 2) - 0.5) * 14, vx: 0, vy: 0 });
    });
    const self = m.get("self"); if (self) { self.x = NCX; self.y = NCY; }
    posRef.current = m;

    let raf = 0, frame = 0;
    const step = () => {
      const pos = posRef.current;
      const arr = [...pos.values()];
      const ids = [...pos.keys()];
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i], b = arr[j];
          let dx = a.x - b.x, dy = a.y - b.y; let d2 = dx * dx + dy * dy || 0.01; const d = Math.sqrt(d2);
          const rep = 16000 / d2; const fx = (dx / d) * rep, fy = (dy / d) * rep;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
      }
      for (const e of edges) {
        const a = pos.get(e.source), b = pos.get(e.target); if (!a || !b) continue;
        let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 0.01;
        const ideal = e.kind === "task" ? 96 : 188;
        const f = (d - ideal) * 0.02; const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      for (let i = 0; i < arr.length; i++) {
        const id = ids[i], p = arr[i];
        // 세로는 강하게 모아 납작하게, 가로는 약하게 당겨 넓게 퍼지도록(좌우 여백 채움)
        p.vx += (NCX - p.x) * 0.0011; p.vy += (NCY - p.y) * 0.0075;
        p.vx *= 0.87; p.vy *= 0.87;
        if (id === "self") { p.x = NCX; p.y = NCY; continue; }
        if (dragRef.current === id) continue;
        p.x += p.vx; p.y += p.vy;
        p.x = Math.max(120, Math.min(NW - 120, p.x)); p.y = Math.max(40, Math.min(NH - 40, p.y));
      }
      force((v) => v + 1);
      if (++frame < 660 || dragRef.current) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [nodes, edges]);

  const toSvg = (e: React.MouseEvent) => {
    const svg = svgRef.current; if (!svg) return null;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM(); if (!ctm) return null;
    const l = pt.matrixTransform(ctm.inverse());
    return { x: l.x, y: l.y };
  };
  const onMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const l = toSvg(e); if (!l) return;
    const p = posRef.current.get(dragRef.current);
    if (p) { p.x = l.x; p.y = l.y; p.vx = 0; p.vy = 0; force((v) => v + 1); }
  };
  const endDrag = () => { dragRef.current = null; };

  return (
    <svg ref={svgRef} viewBox={`0 0 ${NW} ${NH}`} width="100%" style={{ display: "block", userSelect: "none" }}
      onMouseMove={onMove} onMouseUp={endDrag} onMouseLeave={endDrag}>
      <Defs />
      {edges.map((e, i) => {
        const a = posRef.current.get(e.source), b = posRef.current.get(e.target);
        if (!a || !b) return null;
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={e.kind === "task" ? "#e2e8f0" : "#cbd5e1"} strokeWidth={e.kind === "task" ? 1.4 : 2.4} />;
      })}
      {nodes.map((n) => {
        const q = posRef.current.get(n.id); if (!q) return null;
        return <NodeCircle key={n.id} n={n} x={q.x} y={q.y} cx={NCX} onDown={n.id === "self" ? undefined : () => { dragRef.current = n.id; }} />;
      })}
    </svg>
  );
}

// ===== 메인 뷰 =====
export function ResponsibilityView() {
  const [tasks, setTasks] = useState<TaskRecord[] | null>(null);
  const [who, setWho] = useState(TEAM[0]);
  const [mode, setMode] = useState<"radial" | "network">("network");
  const [ana, setAna] = useState<ResponsibilityResponse | null>(null);
  const [anaLoading, setAnaLoading] = useState(false);
  const [anaErr, setAnaErr] = useState<string | null>(null);

  useEffect(() => { fetchTasks().then((d) => setTasks(d.tasks)).catch(() => setTasks([])); }, []);

  async function loadAnalysis(name: string, force = false) {
    setAnaLoading(true); setAnaErr(null);
    try { setAna(await fetchResponsibilityAnalysis(name, force)); }
    catch (e) { setAnaErr(String(e instanceof Error ? e.message : e)); setAna(null); }
    finally { setAnaLoading(false); }
  }
  useEffect(() => { loadAnalysis(who); }, [who]);

  const graph = useMemo(() => (tasks ? buildGraph(tasks, who) : { nodes: [], edges: [] }), [tasks, who]);
  const taskCount = graph.nodes.filter((n) => n.type === "task").length;

  return (
    <div className="full" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 직원 선택 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontWeight: 700, fontSize: 15, marginRight: 4 }}>담당업무 분석</span>
        {TEAM.map((n) => (
          <button key={n} onClick={() => setWho(n)}
            style={{
              cursor: "pointer", fontSize: 14, fontWeight: 700, padding: "7px 15px", borderRadius: 999, whiteSpace: "nowrap",
              border: who === n ? "1px solid #4338ca" : "1px solid var(--border)",
              background: who === n ? "#4338ca" : "#fff", color: who === n ? "#fff" : "#475569",
            }}>{n}</button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 그래프 */}
        <section className="card card--wide" style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
            <h2 className="card__title" style={{ margin: 0 }}>{who} 관계도 <span className="muted" style={{ fontWeight: 400, fontSize: 12.5 }}>· 담당 {taskCount}건</span></h2>
            <div className="seg" style={{ marginLeft: "auto" }}>
              <button className={mode === "radial" ? "is-active" : ""} onClick={() => setMode("radial")}>🌸 방사형</button>
              <button className={mode === "network" ? "is-active" : ""} onClick={() => setMode("network")}>🕸️ 네트워크</button>
            </div>
          </div>
          {mode === "network" && <div className="muted" style={{ fontSize: 12, marginBottom: 2 }}>노드를 끌어서 움직일 수 있어요.</div>}
          {taskCount === 0 ? (
            <div className="state" style={{ background: "transparent" }}>{who}님의 담당 업무 데이터가 아직 없습니다. 노션 업무 DB에서 담당자·협업·연관부서를 채우면 관계도가 그려집니다.</div>
          ) : mode === "radial" ? (
            <RadialGraph nodes={graph.nodes} edges={graph.edges} />
          ) : (
            <NetworkGraph nodes={graph.nodes} edges={graph.edges} />
          )}
          <Legend />
        </section>

        {/* AI 서술 분석 */}
        <section className="card card--wide" style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <h2 className="card__title" style={{ margin: 0, fontSize: 20 }}>🧠 심층 분석</h2>
            <button className="sync-btn" style={{ marginLeft: "auto" }} onClick={() => loadAnalysis(who, true)} disabled={anaLoading}>
              {anaLoading ? "분석 중…" : "🔄 다시"}
            </button>
          </div>
          {anaLoading && !ana && <div className="state" style={{ background: "transparent" }}>담당업무를 분석하는 중…</div>}
          {anaErr && <div className="state state--error">{anaErr}</div>}
          {ana?.error && <div className="state" style={{ background: "transparent", fontSize: 15 }}>{ana.error}</div>}
          {ana?.note && !ana.analysis && <div className="muted" style={{ fontSize: 15 }}>{ana.note}</div>}
          {ana?.analysis && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <p style={{ margin: 0, fontSize: 19, fontWeight: 700, lineHeight: 1.55, color: "#1e1b4b" }}>{ana.analysis.headline}</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "16px 36px", alignItems: "start" }}>
                <Block title="📌 주력 업무" color="#c2410c" items={ana.analysis.mainAreas} />
                <Block title="🤝 협업 관계" color="#1d4ed8" items={ana.analysis.collaboration} />
                {ana.analysis.partners.length > 0 && <Block title="🏢 거래처" color="#047857" items={ana.analysis.partners} />}
                {ana.analysis.notes.length > 0 && <Block title="👀 특이점" color="#6d28d9" items={ana.analysis.notes} />}
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                담당 {ana.count}건 · 진행 {ana.active}건{ana.cached ? " · 캐시" : ""}
                {ana.generatedAt && ` · ${new Date(ana.generatedAt).toLocaleString("ko-KR")} 기준`}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Block({ title, color, items }: { title: string; color: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div style={{ fontSize: 15.5, fontWeight: 800, color, marginBottom: 7 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 7 }}>
        {items.map((it, i) => <li key={i} style={{ fontSize: 16.5, lineHeight: 1.55 }}>{it}</li>)}
      </ul>
    </div>
  );
}
