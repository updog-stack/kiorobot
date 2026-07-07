import { useRef, useState } from "react";
import {
  generatePrompt,
  DELIVERABLES,
  PROMPT_MODELS,
  type PromptResult,
} from "../lib/promptgen";

export function PromptGen() {
  const [topic, setTopic] = useState("");
  const [deliverables, setDeliverables] = useState<string[]>([]);
  const [audience, setAudience] = useState("");
  const [persona, setPersona] = useState("");
  const [extra, setExtra] = useState("");
  const [model, setModel] = useState(PROMPT_MODELS[0].id);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PromptResult | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  function toggleDeliverable(id: string) {
    setDeliverables((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  }

  async function run() {
    if (topic.trim().length < 2) {
      setError("분야/주제를 입력해 주세요.");
      return;
    }
    if (deliverables.length === 0) {
      setError("만들 콘텐츠(산출물)를 하나 이상 선택해 주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const r = await generatePrompt(
        { topic, deliverables, audience, persona, extra, model },
        controller.signal
      );
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
    setDeliverables([]);
    setAudience("");
    setPersona("");
    setExtra("");
    setResult(null);
    setError(null);
    setLoading(false);
  }

  function copyPrompt() {
    if (!result?.prompt) return;
    navigator.clipboard?.writeText(result.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="blog">
      <section className="card blog-form">
        <h2 className="card__title">🪄 프롬프트 생성기</h2>
        <p className="card__desc">
          분야와 만들 콘텐츠를 고르면, <b>ChatGPT·Claude 같은 AI 채팅창에 그대로 붙여넣어 쓰는 지시문(프롬프트)</b>을
          만들어 줍니다. 결과물은 완성된 글이 아니라 <b>AI에게 시킬 명령문</b>이에요. 붙여넣고 <code>주제: OO</code> 만 던지면 됩니다.
        </p>

        <label className="blog-field">
          <span>분야 / 주제 *</span>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="예: 무인매장 창업 / 키오스크 도입 / 자영업 절세"
          />
        </label>

        <div className="blog-field">
          <span>만들 콘텐츠 (여러 개 선택)</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
            {DELIVERABLES.map((d) => {
              const on = deliverables.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDeliverable(d.id)}
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
                  {d.icon} {d.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="blog-row">
          <label className="blog-field">
            <span>타겟 독자 (선택)</span>
            <input
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="예: 40대 창업 준비자, 완전 초보"
            />
          </label>
          <label className="blog-field">
            <span>역할·말투 (선택)</span>
            <input
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              placeholder="예: 전문 블로거이자 유튜버, 1인칭 구어체"
            />
          </label>
        </div>

        <div className="blog-row">
          <label className="blog-field">
            <span>추가 지침 (선택)</span>
            <textarea
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              rows={3}
              placeholder="예: 시리즈물로 이어짐, 수익은 사례로만, 협찬 표기 전제 등"
            />
          </label>
          <label className="blog-field">
            <span>생성 모델</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {PROMPT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>
        </div>

        {error && <div className="state state--error">{error}</div>}

        <div className="blog-actions">
          <button className="blog-run" onClick={run} disabled={loading}>
            {loading ? "생성 중… (모델에 따라 최대 1분)" : "프롬프트 생성"}
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
        <section className="card blog-result">
          {result.cost && (
            <p className="blog-cost">
              이번 생성 비용: 약 <b>{result.cost.krw.toLocaleString()}원</b> · 토큰 입력{" "}
              {result.cost.inputTokens.toLocaleString()} / 출력 {result.cost.outputTokens.toLocaleString()}
              {result.usedModel ? ` · ${result.usedModel}` : ""}
            </p>
          )}
          <div className="blog-improved__head">
            <h3>✨ 완성된 프롬프트 — AI 채팅창에 붙여넣어 사용</h3>
            <button className="blog-run blog-copy-all" onClick={copyPrompt}>
              {copied ? "복사됨 ✓" : "프롬프트 복사"}
            </button>
          </div>
          <textarea
            className="blog-improved__body"
            readOnly
            value={result.prompt}
            rows={Math.min(40, Math.max(12, result.prompt.split("\n").length + 2))}
            onFocus={(e) => e.target.select()}
          />
          <p className="card__desc" style={{ marginTop: 8 }}>
            사용법: 위 프롬프트를 복사해 ChatGPT·Claude 대화 맨 처음에 붙여넣은 뒤, <code>주제: (원하는 소재)</code> 형식으로 던지세요.
          </p>
        </section>
      )}
    </div>
  );
}
