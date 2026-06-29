import { useRef, useState } from "react";
import {
  analyzeBlog,
  fileToImage,
  BLOG_MODELS,
  SEVERITY,
  scoreColor,
  type BlogResult,
  type BlogImage,
} from "../lib/blog";

const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export function BlogChecker() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [model, setModel] = useState(BLOG_MODELS[0].id);
  const [kioskModel, setKioskModel] = useState("");
  const [images, setImages] = useState<BlogImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BlogResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function onPickImages(files: FileList | null) {
    if (!files) return;
    const picked: BlogImage[] = [];
    for (const f of Array.from(files)) {
      if (ALLOWED.includes(f.type)) picked.push(await fileToImage(f));
    }
    setImages((prev) => [...prev, ...picked].slice(0, 6));
  }

  async function run() {
    if (body.trim().length < 10) {
      setError("본문을 10자 이상 입력해 주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const r = await analyzeBlog(
        { title, body, images, model, kioskModel: kioskModel.trim() || undefined },
        controller.signal
      );
      setResult(r);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("분석을 중단했습니다.");
      } else {
        setError(String(e instanceof Error ? e.message : e));
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  function reset() {
    abortRef.current?.abort();
    setTitle("");
    setBody("");
    setKioskModel("");
    setImages([]);
    setResult(null);
    setError(null);
    setLoading(false);
  }

  return (
    <div className="blog">
      <section className="card blog-form">
        <h2 className="card__title">📝 네이버 블로그 게시글 검사기</h2>
        <p className="card__desc">
          제목·본문을 넣으면 AI가 검색 노출(SEO) 관점에서 점수·문제점·개선안과
          <b> 그대로 복사해 쓸 개선본</b>을 만들어 줍니다.
        </p>

        <label className="blog-field">
          <span>제목</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="블로그 글 제목" />
        </label>

        <label className="blog-field">
          <span>본문 *</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            placeholder="블로그 본문을 붙여넣으세요 (10자 이상)"
          />
          <small className="blog-count">{body.length.toLocaleString()}자</small>
        </label>

        <div className="blog-row">
          <label className="blog-field">
            <span>분석 모델</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {BLOG_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className="blog-field">
            <span>키오스크 모델명 (선택)</span>
            <input value={kioskModel} onChange={(e) => setKioskModel(e.target.value)} placeholder="개선본에 넣을 제품명" />
          </label>
        </div>

        <label className="blog-field">
          <span>사진 첨부 (선택, 최대 6장)</span>
          <input type="file" accept="image/*" multiple onChange={(e) => onPickImages(e.target.files)} />
        </label>
        {images.length > 0 && (
          <div className="blog-imgs">
            {images.map((im, i) => (
              <span key={i} className="blog-img-chip">
                {im.name}
                <button onClick={() => setImages(images.filter((_, j) => j !== i))} aria-label="삭제">✕</button>
              </span>
            ))}
          </div>
        )}

        {error && <div className="state state--error">{error}</div>}

        <div className="blog-actions">
          <button className="blog-run" onClick={run} disabled={loading}>
            {loading ? "분석 중… (모델에 따라 최대 1분)" : "검사하기"}
          </button>
          {loading && (
            <button className="blog-cancel" onClick={cancel}>
              ■ 분석 중단
            </button>
          )}
          <button className="blog-reset" onClick={reset}>
            초기화
          </button>
        </div>
      </section>

      {result && <BlogResultView data={result} />}
    </div>
  );
}

function copy(text: string) {
  navigator.clipboard?.writeText(text);
}

function BlogResultView({ data }: { data: BlogResult }) {
  const [copied, setCopied] = useState("");
  function doCopy(key: string, text: string) {
    copy(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 1200);
  }
  const fullImproved = (data.improvedTitle ? data.improvedTitle + "\n\n" : "") + (data.improvedBody || "");

  return (
    <section className="card blog-result">
      <div className="blog-score">
        <div className="blog-score__circle" style={{ borderColor: scoreColor(data.overallScore) }}>
          <strong style={{ color: scoreColor(data.overallScore) }}>{data.overallScore}</strong>
          <small>/ 100</small>
        </div>
        <div className="blog-score__sum">
          <h3>총평</h3>
          <p>{data.summary}</p>
          {data.mainKeyword && <p className="blog-kw">핵심 키워드: <b>{data.mainKeyword}</b></p>}
          {data.usedModel && <p className="blog-model">분석 모델: {data.usedModel}</p>}
        </div>
      </div>

      {data.cost && (
        <p className="blog-cost">
          이번 분석 비용: 약 <b>{data.cost.krw.toLocaleString()}원</b> · 토큰 입력 {data.cost.inputTokens.toLocaleString()} / 출력 {data.cost.outputTokens.toLocaleString()}
        </p>
      )}

      {data.improvedBody && (
        <div className="blog-block blog-improved">
          <div className="blog-improved__head">
            <h3>✨ AI 개선본 — 복사해서 그대로 사용</h3>
            <button className="blog-run blog-copy-all" onClick={() => doCopy("all", fullImproved)}>
              {copied === "all" ? "복사됨 ✓" : "제목+본문 전체 복사"}
            </button>
          </div>
          {data.improvedTitle && (
            <div className="blog-improved__title-row">
              <div className="blog-improved__title">{data.improvedTitle}</div>
              <button className="blog-copy" onClick={() => doCopy("title", data.improvedTitle)}>
                {copied === "title" ? "복사됨" : "제목 복사"}
              </button>
            </div>
          )}
          <textarea
            className="blog-improved__body"
            readOnly
            value={data.improvedBody}
            rows={Math.min(22, Math.max(8, data.improvedBody.split("\n").length + 2))}
            onFocus={(e) => e.target.select()}
          />
          <button className="blog-mini" onClick={() => doCopy("body", data.improvedBody)}>
            {copied === "body" ? "복사됨 ✓" : "본문만 복사"}
          </button>
        </div>
      )}

      <div className="blog-block">
        <h3>제목 평가 ({data.titleFeedback.score}점)</h3>
        <p>{data.titleFeedback.comment}</p>
        {data.rewrittenTitleSuggestions?.length > 0 && (
          <ul className="blog-titles">
            {data.rewrittenTitleSuggestions.map((t, i) => (
              <li key={i}>
                <span>{t}</span>
                <button className="blog-copy" onClick={() => doCopy(`t${i}`, t)}>
                  {copied === `t${i}` ? "복사됨" : "복사"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="blog-block">
        <h3>고칠 점 {data.issues.length}개</h3>
        {data.issues.length === 0 ? (
          <p>특별히 고칠 점이 없습니다. 잘 작성하셨어요!</p>
        ) : (
          <ul className="blog-issues">
            {data.issues.map((issue, i) => {
              const sev = SEVERITY[issue.severity] || SEVERITY.low;
              return (
                <li key={i} className={sev.cls}>
                  <div className="blog-issue__head">
                    <span className="blog-sev">{sev.label}</span>
                    <span className="blog-loc">{issue.location}</span>
                  </div>
                  <p className="blog-prob">{issue.problem}</p>
                  <p className="blog-fix">→ {issue.suggestion}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {data.strengths?.length > 0 && (
        <div className="blog-block">
          <h3>잘한 점</h3>
          <ul className="blog-strengths">
            {data.strengths.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
