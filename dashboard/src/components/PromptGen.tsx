import { useRef, useState } from "react";
import {
  generateContent,
  PLATFORMS,
  TONES,
  CONTENT_MODELS,
  type ContentResult,
  type PlatformContent,
} from "../lib/promptgen";

export function PromptGen() {
  const [topic, setTopic] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [tone, setTone] = useState(TONES[0].id);
  const [extra, setExtra] = useState("");
  const [model, setModel] = useState(CONTENT_MODELS[0].id);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ContentResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function togglePlatform(id: string) {
    setPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  async function run() {
    if (topic.trim().length < 2) {
      setError("주제/키워드를 입력해 주세요.");
      return;
    }
    if (platforms.length === 0) {
      setError("플랫폼을 하나 이상 선택해 주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const r = await generateContent({ topic, platforms, tone, extra, model }, controller.signal);
      setResult(r);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") setError("생성을 중단했습니다.");
      else setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  function reset() {
    abortRef.current?.abort();
    setTopic("");
    setExtra("");
    setResult(null);
    setError(null);
    setLoading(false);
  }

  return (
    <div className="blog">
      <section className="card blog-form">
        <h2 className="card__title">🪄 프롬프트 생성기 — 노출 콘텐츠</h2>
        <p className="card__desc">
          주제/키워드만 넣으면 <b>유튜브·인스타그램·틱톡·네이버 블로그</b>에 바로 올릴 제목·설명·해시태그를 만들어 줍니다.
          결과는 <b>그대로 복사</b>해 사용하세요.
        </p>

        <label className="blog-field">
          <span>주제 / 키워드 *</span>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="예: 키오스크 신제품 출시 / 무인주문 매장 도입 효과"
          />
        </label>

        <div className="blog-field">
          <span>플랫폼 (여러 개 선택)</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
            {PLATFORMS.map((p) => {
              const on = platforms.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => togglePlatform(p.id)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: `1.5px solid ${on ? "#2563eb" : "var(--border)"}`,
                    background: on ? "#2563eb" : "transparent",
                    color: on ? "#fff" : "var(--text)",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {p.icon} {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="blog-row">
          <label className="blog-field">
            <span>톤 / 스타일</span>
            <select value={tone} onChange={(e) => setTone(e.target.value)}>
              {TONES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="blog-field">
            <span>생성 모델</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {CONTENT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="blog-field">
          <span>추가 정보 (선택) — 제품명·강조점·이벤트</span>
          <textarea
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            rows={3}
            placeholder="예: 제품명 'DAIN-K1', 이번 달 설치비 무료 이벤트, 회전율 개선 강조"
          />
        </label>

        {error && <div className="state state--error">{error}</div>}

        <div className="blog-actions">
          <button className="blog-run" onClick={run} disabled={loading}>
            {loading ? "생성 중… (모델에 따라 최대 1분)" : "콘텐츠 생성"}
          </button>
          {loading && (
            <button className="blog-cancel" onClick={() => abortRef.current?.abort()}>
              ■ 중단
            </button>
          )}
          <button className="blog-reset" onClick={reset}>초기화</button>
        </div>
      </section>

      {result && (
        <>
          {result.cost && (
            <p className="blog-cost">
              이번 생성 비용: 약 <b>{result.cost.krw.toLocaleString()}원</b> · 토큰 입력{" "}
              {result.cost.inputTokens.toLocaleString()} / 출력 {result.cost.outputTokens.toLocaleString()}
              {result.usedModel ? ` · ${result.usedModel}` : ""}
            </p>
          )}
          {result.results.length === 0 ? (
            <div className="state">생성된 콘텐츠가 없습니다. 다시 시도해 주세요.</div>
          ) : (
            result.results.map((c) => <PlatformCard key={c.platform} c={c} />)
          )}
        </>
      )}
    </div>
  );
}

function copy(text: string) {
  navigator.clipboard?.writeText(text);
}

function PlatformCard({ c }: { c: PlatformContent }) {
  const [copied, setCopied] = useState("");
  function doCopy(key: string, text: string) {
    copy(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 1200);
  }
  const icon = PLATFORMS.find((p) => p.id === c.platform)?.icon ?? "•";
  const fullText = [
    c.titles[0] ? `[제목]\n${c.titles.join("\n")}` : "",
    c.body ? `\n[본문/설명]\n${c.body}` : "",
    c.hashtags.length ? `\n[해시태그]\n${c.hashtags.join(" ")}` : "",
    c.tags.length ? `\n[검색 태그]\n${c.tags.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <section className="card blog-result">
      <div className="blog-improved__head">
        <h3>{icon} {c.label}</h3>
        <button className="blog-run blog-copy-all" onClick={() => doCopy("all", fullText)}>
          {copied === "all" ? "복사됨 ✓" : "전체 복사"}
        </button>
      </div>

      {c.titles.length > 0 && (
        <div className="blog-block">
          <h3>제목 / 후킹 후보</h3>
          <ul className="blog-titles">
            {c.titles.map((t, i) => (
              <li key={i}>
                <span>{t}</span>
                <button className="blog-copy" onClick={() => doCopy(`t${i}`, t)}>
                  {copied === `t${i}` ? "복사됨" : "복사"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {c.body && (
        <div className="blog-block">
          <h3>본문 / 설명</h3>
          <textarea
            className="blog-improved__body"
            readOnly
            value={c.body}
            rows={Math.min(16, Math.max(4, c.body.split("\n").length + 2))}
            onFocus={(e) => e.target.select()}
          />
          <button className="blog-mini" onClick={() => doCopy("body", c.body)}>
            {copied === "body" ? "복사됨 ✓" : "본문 복사"}
          </button>
        </div>
      )}

      {c.hashtags.length > 0 && (
        <div className="blog-block">
          <h3>해시태그 {c.hashtags.length}개</h3>
          <p style={{ lineHeight: 1.9, color: "#2563eb", wordBreak: "keep-all" }}>
            {c.hashtags.join(" ")}
          </p>
          <button className="blog-mini" onClick={() => doCopy("tags", c.hashtags.join(" "))}>
            {copied === "tags" ? "복사됨 ✓" : "해시태그 복사"}
          </button>
        </div>
      )}

      {c.tags.length > 0 && (
        <div className="blog-block">
          <h3>검색 태그 (유튜브 태그)</h3>
          <p style={{ lineHeight: 1.8, color: "var(--muted, #64748b)", wordBreak: "keep-all" }}>
            {c.tags.join(", ")}
          </p>
          <button className="blog-mini" onClick={() => doCopy("stags", c.tags.join(", "))}>
            {copied === "stags" ? "복사됨 ✓" : "검색 태그 복사"}
          </button>
        </div>
      )}

      {c.tips.length > 0 && (
        <div className="blog-block">
          <h3>노출 팁</h3>
          <ul className="blog-strengths">
            {c.tips.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
