import { useEffect, useRef, useState } from "react";
import {
  fetchCs,
  syncCs,
  setCsStatus,
  type CsAgent,
  type CsChat,
  type CsData,
  type CsStatusCode,
} from "../lib/cs";

const REFRESH_MS = 10 * 60 * 1000; // 10분 자동 갱신

interface ChatModal {
  title: string;
  items: CsChat[];
}

export function CsStatus() {
  const [data, setData] = useState<CsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [modal, setModal] = useState<ChatModal | null>(null);
  const timer = useRef<number | null>(null);

  async function load(silent = false) {
    try {
      const d = await fetchCs();
      setData(d);
      if (!silent) setError(null);
    } catch (e) {
      if (!silent) setError(String(e));
    }
  }

  useEffect(() => {
    load();
    timer.current = window.setInterval(() => load(true), REFRESH_MS);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      setData(await syncCs());
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSyncing(false);
    }
  }

  async function handleSetStatus(name: string, status: CsStatusCode | "auto") {
    try {
      setData(await setCsStatus(name, status));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  function openList(title: string, items?: CsChat[]) {
    setModal({ title, items: items ?? [] });
  }

  if (error && !data) return <div className="state state--error">불러오기 실패: {error}</div>;
  if (!data) return <div className="state">CS 현황을 불러오는 중…</div>;

  const s = data.summary;

  return (
    <div className="sales">
      <div className="sales__toolbar">
        <span className="sales__updated">
          갱신 {new Date(data.updatedAt).toLocaleString("ko-KR")} · 10분마다 자동 갱신
        </span>
        <button className="sync-btn" onClick={handleSync} disabled={syncing}>
          {syncing ? "동기화 중…" : "↻ 지금 동기화"}
        </button>
      </div>

      {error && <div className="state state--error">갱신 실패: {error}</div>}
      {data.source !== "channeltalk" && (
        <div className="state">{data.note || "목업 데이터 — 채널톡 연동 시 실데이터로 표시됩니다."}</div>
      )}

      {/* 요약 KPI (클릭 시 전체 목록) */}
      <div className="sales__kpis">
        <Kpi
          label="미응대 대기"
          value={`${s.waiting}건`}
          tone={s.waiting > 0 ? "danger" : "ok"}
          hint="전체(미배정 포함)"
          onClick={() => openList(`미응대 대기 · 전체 (${s.waiting}건)`, data.lists?.waiting)}
        />
        <Kpi
          label="진행 중 상담"
          value={`${s.ongoing}건`}
          hint="현재 응대 중"
          onClick={() => openList(`진행 중 상담 · 전체 (${s.ongoing}건)`, data.lists?.ongoing)}
        />
        <Kpi
          label="오늘 처리"
          value={`${s.todayHandled}건`}
          hint="금일 완료"
          onClick={() => openList(`오늘 처리 · 전체 (${s.todayHandled}건)`, data.lists?.today)}
        />
        <Kpi
          label="온라인"
          value={`${s.online}/${s.total}명`}
          hint="실시간 접속"
          onClick={() =>
            openList(
              `온라인 담당자 (${s.online}명)`,
              data.agents.filter((a) => a.online).map((a) => ({ name: `${a.name} · ${a.statusLabel}`, url: "" }))
            )
          }
        />
      </div>

      {/* 담당자 카드 */}
      <section className="card card--wide">
        <h2 className="card__title">담당자별 현황</h2>
        <div className="agents">
          {data.agents.map((a) => (
            <AgentCard key={a.name} agent={a} onSetStatus={handleSetStatus} onOpenList={openList} />
          ))}
        </div>
      </section>

      {modal && <ChatListModal modal={modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "danger";
  onClick?: () => void;
}) {
  return (
    <section
      className={`metric${onClick ? " metric--btn" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <div className="metric__label">{label}</div>
      <div
        className="metric__amount"
        style={{ color: tone === "danger" ? "#b91c1c" : tone === "ok" ? "#047857" : undefined }}
      >
        {value}
      </div>
      {hint && <div className="metric__hint">{hint}</div>}
    </section>
  );
}

function AgentCard({
  agent,
  onSetStatus,
  onOpenList,
}: {
  agent: CsAgent;
  onSetStatus: (name: string, status: CsStatusCode | "auto") => void;
  onOpenList: (title: string, items?: CsChat[]) => void;
}) {
  const nick = agent.name.length >= 3 ? agent.name.slice(-2) : agent.name;

  const Stat = ({ num, cap, items, danger }: { num: number; cap: string; items?: CsChat[]; danger?: boolean }) => (
    <button
      className="agent__stat agent__stat--btn"
      onClick={() => onOpenList(`${agent.name} · ${cap} (${num}건)`, items)}
      disabled={num === 0}
      title={num > 0 ? "클릭하면 상담 매장 목록" : "내역 없음"}
    >
      <span className="agent__num" style={{ color: danger && num > 0 ? "#b91c1c" : undefined }}>
        {num}
      </span>
      <span className="agent__cap">{cap}</span>
    </button>
  );

  return (
    <div className={`agent agent--${agent.status}`}>
      <div className="agent__head">
        <div className={`agent__avatar agent__avatar--${agent.status}`}>{nick}</div>
        <div className="agent__id">
          <div className="agent__name">
            {agent.name}
            {agent.manual && <span className="agent__manual">수동</span>}
          </div>
          <div className="agent__status">
            <span className={`dotc dotc--${agent.status}`} /> {agent.statusLabel}
          </div>
        </div>
        {agent.waiting > 0 && <div className="agent__alert">대기 {agent.waiting}</div>}
      </div>

      <select
        className="agent__select"
        value={agent.manual ? agent.status : "auto"}
        onChange={(e) => onSetStatus(agent.name, e.target.value as CsStatusCode | "auto")}
        title="상태 직접 지정 (당일 유지, 다음날 자동 초기화)"
      >
        <option value="auto">자동(채널톡 상태)</option>
        <option value="available">대기중</option>
        <option value="busy">상담중</option>
        <option value="away">자리비움/다른 업무중</option>
        <option value="offline">오프라인</option>
      </select>

      <div className="agent__stats agent__stats--3">
        <Stat num={agent.todayHandled} cap="오늘 처리" items={agent.todayChats} />
        <Stat num={agent.ongoing} cap="진행중" items={agent.ongoingChats} />
        <Stat num={agent.waiting} cap="대기" items={agent.waitingChats} danger />
      </div>
    </div>
  );
}

function ChatListModal({ modal, onClose }: { modal: ChatModal; onClose: () => void }) {
  return (
    <div className="modal__backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h3 className="modal__title">{modal.title}</h3>
          <button className="modal__close" onClick={onClose}>
            ✕
          </button>
        </div>
        {modal.items.length === 0 ? (
          <div className="state">내역이 없습니다.</div>
        ) : (
          <ul className="modal__list">
            {modal.items.map((c, i) => (
              <li key={i}>
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer">
                    {c.name}
                    <span className="modal__link">채널톡에서 열기 ↗</span>
                  </a>
                ) : (
                  <span className="modal__plain">{c.name}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
