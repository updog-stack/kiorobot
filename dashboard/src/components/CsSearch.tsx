import { useEffect, useState } from "react";
import {
  getCsIndex,
  collectCsIndex,
  searchCs,
  type CsIndexMeta,
  type CsSearchResult,
} from "../lib/csSearch";

const CONF: Record<string, { label: string; cls: string }> = {
  high: { label: "근거 충분", cls: "cs-conf--high" },
  medium: { label: "참고 수준", cls: "cs-conf--medium" },
  low: { label: "근거 부족", cls: "cs-conf--low" },
  none: { label: "기록 없음", cls: "cs-conf--low" },
};

// 로컬 기준 YYYY-MM-DD
function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function CsSearch() {
  const [meta, setMeta] = useState<CsIndexMeta | null>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<CsSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collectInfo, setCollectInfo] = useState<string | null>(null);

  // 기본 기간: 최근 90일 ~ 오늘
  const today = localDate(new Date());
  const ninetyAgo = localDate(new Date(Date.now() - 90 * 24 * 3600 * 1000));
  const [from, setFrom] = useState(ninetyAgo);
  const [to, setTo] = useState(today);

  useEffect(() => {
    getCsIndex().then(setMeta).catch(() => setMeta({ exists: false }));
  }, []);

  async function doSearch() {
    if (query.trim().length < 2) {
      setError("검색어를 2자 이상 입력하세요.");
      return;
    }
    setSearching(true);
    setError(null);
    setResult(null);
    try {
      setResult(await searchCs(query.trim()));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSearching(false);
    }
  }

  async function doCollect() {
    if (from > to) {
      setError("시작일이 종료일보다 늦습니다. 기간을 확인하세요.");
      return;
    }
    setRefreshing(true);
    setError(null);
    setCollectInfo(null);
    // 한 요청은 짧게(청크) 유지하고, 남은 신규(truncated)가 0이 될 때까지 자동 반복 → 사실상 한도 없음.
    const CHUNK = 400;
    const MAX_ROUNDS = 500; // 안전장치(최대 20만 건)
    let totalAdded = 0;
    let count = 0;
    try {
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const r = await collectCsIndex(from, to, CHUNK);
        totalAdded += r.added ?? 0;
        count = r.count ?? count;
        const remaining = r.truncated ?? 0;
        setCollectInfo(
          `수집 중… 신규 ${totalAdded.toLocaleString()}건${
            remaining ? ` · 남은 약 ${remaining.toLocaleString()}건` : ""
          } (총 ${count.toLocaleString()}건)`
        );
        setMeta(await getCsIndex());
        // 남은 게 없거나, 이번 라운드에 새로 모은 게 없으면(전부 본문 없음 등) 종료
        if (!remaining || (r.added ?? 0) === 0) break;
      }
      setCollectInfo(
        `✅ 완료 · 이번에 신규 ${totalAdded.toLocaleString()}건 수집 (총 ${count.toLocaleString()}건 검색 가능)`
      );
      setMeta(await getCsIndex());
    } catch (e) {
      // 진행분은 서버가 라운드마다 저장하므로 유실 없음. 다시 누르면 이어서 수집.
      setMeta(await getCsIndex().catch(() => meta));
      setError(
        `수집 중 오류(지금까지 신규 ${totalAdded.toLocaleString()}건은 저장됨): ${String(
          e instanceof Error ? e.message : e
        )} — 다시 누르면 이어서 수집합니다.`
      );
    } finally {
      setRefreshing(false);
    }
  }

  const conf = result ? CONF[result.confidence] ?? CONF.medium : null;

  return (
    <div className="cs-search">
      {/* 인덱스 상태 + 기간 수집 바 */}
      <div className="cs-index-bar">
        <div className="cs-index-bar__top">
          {meta?.exists ? (
            <span className="cs-index-bar__info">
              상담 기록 <b>{meta.count?.toLocaleString()}건</b> 검색 가능
              {meta.lastBuilt && ` · ${new Date(meta.lastBuilt).toLocaleString("ko-KR")} 기준`}
            </span>
          ) : (
            <span className="cs-index-bar__info">
              아직 상담 기록이 모이지 않았습니다. 기간을 정해 수집해 주세요.
            </span>
          )}
        </div>

        <div className="cs-collect">
          <label className="cs-collect__field">
            <span>시작일</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              disabled={refreshing}
            />
          </label>
          <span className="cs-collect__tilde">~</span>
          <label className="cs-collect__field">
            <span>종료일</span>
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => setTo(e.target.value)}
              disabled={refreshing}
            />
          </label>
          <button className="cs-refresh" onClick={doCollect} disabled={refreshing}>
            {refreshing ? "수집 중… (자동 진행)" : "📥 이 기간 수집"}
          </button>
        </div>
        <p className="cs-collect__hint">
          선택한 기간의 종료된 상담을 <b>한도 없이 전부</b> 자동으로 모읍니다(끝날 때까지 이어서 수집). <b>이미 모은 상담은 자동으로 건너뛰어</b> 중복 수집하지 않으며, 건수가 많으면 수 분~수십 분 걸릴 수 있습니다.
        </p>
        {collectInfo && <p className="cs-collect__result">✅ {collectInfo}</p>}
      </div>

      {/* 검색창 */}
      <div className="cs-searchbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch()}
          placeholder="예: 카드결제가 안돼 / 키오스크 동전 안먹힘 / 정산 언제 들어와요"
          disabled={!meta?.exists}
        />
        <button className="cs-search-btn" onClick={doSearch} disabled={searching || !meta?.exists}>
          {searching ? "분석 중…" : "🔍 검색"}
        </button>
      </div>

      {error && <div className="state state--error">{error}</div>}

      {refreshing && (
        <div className="state">
          채널톡 상담 기록을 모으는 중입니다. 최초 1회는 수 분 걸릴 수 있어요. (이후 검색은 즉시)
        </div>
      )}

      {result && (
        <>
          {result.note && !result.answer ? (
            <div className="state">{result.note}</div>
          ) : (
            <section className="card cs-answer">
              <div className="cs-answer__head">
                <h3>💡 원포인트 답변</h3>
                {conf && <span className={`cs-conf ${conf.cls}`}>{conf.label}</span>}
              </div>
              <div className="cs-answer__text">{result.answer}</div>
              {result.steps.length > 0 && (
                <ol className="cs-answer__steps">
                  {result.steps.map((s, i) => (
                    <li key={i}>{s.replace(/^\s*\d+[.)]\s*/, "")}</li>
                  ))}
                </ol>
              )}
              <p className="cs-answer__disc">
                ※ 과거 상담 기록을 AI가 요약한 것입니다. 실제 응대 시 아래 원본 기록으로 확인하세요.
              </p>
            </section>
          )}

          {result.sources.length > 0 && (
            <section className="card cs-sources">
              <h3 className="card__title">관련 상담 기록 {result.sources.length}건</h3>
              <ul className="cs-source-list">
                {result.sources.map((s) => (
                  <li key={s.id} className={`cs-source${s.used ? " cs-source--used" : ""}`}>
                    <div className="cs-source__meta">
                      {s.used && <span className="cs-source__badge">답변 근거</span>}
                      {s.date && <span>{s.date.slice(0, 10)}</span>}
                      {s.tags?.length > 0 && <span className="cs-source__tags">{s.tags.join(", ")}</span>}
                      {s.url && (
                        <a href={s.url} target="_blank" rel="noreferrer" className="cs-source__link">
                          채널톡에서 열기 ↗
                        </a>
                      )}
                    </div>
                    <div className="cs-source__text">{s.text}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
