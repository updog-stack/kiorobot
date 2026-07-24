import { useEffect, useRef, useState } from "react";
import {
  analyzeBlog,
  generateBlog,
  copyText,
  fileToImage,
  BLOG_MODELS,
  SEVERITY,
  scoreColor,
  DEFAULT_GEN_PROMPT,
  type AnalyzeInput,
  type BlogResult,
  type BlogImage,
  type GenerateInput,
  type GenerateResult,
} from "../lib/blog";

const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"];
// 추가 지시(프롬프트)는 브라우저에 저장해 새로고침·초기화 후에도 유지한다.
const PROMPT_KEY = "blog.extraPrompt";
const GEN_PROMPT_KEY = "blog.genPrompt";
const MODE_KEY = "blog.mode";
type BlogMode = "check" | "generate";

export function BlogChecker() {
  const [mode, setMode] = useState<BlogMode>("check");

  useEffect(() => {
    try {
      const m = localStorage.getItem(MODE_KEY);
      if (m === "check" || m === "generate") setMode(m);
    } catch {
      /* 무시 */
    }
  }, []);

  function switchMode(m: BlogMode) {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* 무시 */
    }
  }

  return (
    <div className="blog">
      <div className="blog-mode" role="tablist">
        <button
          role="tab"
          className={`blog-mode__btn${mode === "check" ? " active" : ""}`}
          onClick={() => switchMode("check")}
        >
          🔍 SEO 검사
        </button>
        <button
          role="tab"
          className={`blog-mode__btn${mode === "generate" ? " active" : ""}`}
          onClick={() => switchMode("generate")}
        >
          ✍️ 글 생성
        </button>
      </div>
      {mode === "check" ? <BlogCheckPanel /> : <BlogGeneratePanel />}
    </div>
  );
}

function BlogCheckPanel() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [extraPrompt, setExtraPrompt] = useState("");
  const [savedPrompt, setSavedPrompt] = useState("");
  const [promptSaved, setPromptSaved] = useState(false);
  const [model, setModel] = useState(BLOG_MODELS[0].id);
  const [kioskModel, setKioskModel] = useState("");
  const [images, setImages] = useState<BlogImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BlogResult | null>(null);
  // 재검사에 사용할 '실제 분석된 입력'과 사용자가 남긴 요청(채팅) 이력
  const [lastInput, setLastInput] = useState<AnalyzeInput | null>(null);
  const [feedbackLog, setFeedbackLog] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // 저장해 둔 프롬프트를 처음 열 때 불러온다.
  useEffect(() => {
    try {
      let s = localStorage.getItem(PROMPT_KEY) || "";
      // 예전에 '글 생성'용 프롬프트가 검사 '추가 지시'에 잘못 저장돼 있으면 1회 정리한다.
      // (이 칸은 검사에 얹는 짧은 지시 전용이라, 생성 프롬프트가 들어가면 검사 결과가 왜곡됨)
      if (s.includes("블로그 게시글 생성 프롬프트") || s.includes("너는 무인매장 솔루션")) {
        localStorage.removeItem(PROMPT_KEY);
        s = "";
      }
      setExtraPrompt(s);
      setSavedPrompt(s);
    } catch {
      /* localStorage 미지원 환경은 무시 */
    }
  }, []);

  // 모드 전환 등으로 언마운트되면 진행 중이던 요청을 중단한다.
  useEffect(() => () => abortRef.current?.abort(), []);

  const promptDirty = extraPrompt !== savedPrompt;

  function savePrompt() {
    try {
      localStorage.setItem(PROMPT_KEY, extraPrompt);
    } catch {
      /* 저장 실패는 조용히 무시 */
    }
    setSavedPrompt(extraPrompt);
    setPromptSaved(true);
    setTimeout(() => setPromptSaved(false), 1500);
  }

  function revertPrompt() {
    setExtraPrompt(savedPrompt);
  }

  async function onPickImages(files: FileList | null) {
    if (!files) return;
    const picked: BlogImage[] = [];
    for (const f of Array.from(files)) {
      if (ALLOWED.includes(f.type)) picked.push(await fileToImage(f));
    }
    setImages((prev) => [...prev, ...picked].slice(0, 6));
  }

  function toError(e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") {
      setError("분석을 중단했습니다.");
    } else {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  async function run() {
    if (body.trim().length < 10) {
      setError("본문을 10자 이상 입력해 주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setFeedbackLog([]);
    const input: AnalyzeInput = {
      title,
      body,
      images,
      model,
      kioskModel: kioskModel.trim() || undefined,
      extraPrompt: extraPrompt.trim() || undefined,
    };
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const r = await analyzeBlog(input, controller.signal);
      setResult(r);
      setLastInput(input);
    } catch (e) {
      toError(e);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  // 결과 화면에서 남긴 요청(채팅)을 반영해 다시 검사
  async function reanalyze(feedback: string) {
    const fb = feedback.trim();
    if (!fb || !lastInput || !result) return;
    setReloading(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const r = await analyzeBlog(
        { ...lastInput, feedback: fb, prevResult: result },
        controller.signal
      );
      setResult(r);
      setFeedbackLog((prev) => [...prev, fb]);
    } catch (e) {
      toError(e);
    } finally {
      setReloading(false);
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
    setExtraPrompt(savedPrompt); // 저장한 프롬프트는 초기화해도 유지
    setKioskModel("");
    setImages([]);
    setResult(null);
    setLastInput(null);
    setFeedbackLog([]);
    setError(null);
    setLoading(false);
    setReloading(false);
  }

  return (
    <>
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

        <div className="blog-field blog-prompt">
          <div className="blog-prompt__head">
            <span>검사 시 추가 지시사항 (선택, 짧게)</span>
            <div className="blog-prompt__actions">
              {promptDirty && <span className="blog-prompt__dirty">● 미저장</span>}
              {promptDirty && (
                <button type="button" className="blog-mini" onClick={revertPrompt}>
                  저장값으로
                </button>
              )}
              <button
                type="button"
                className="blog-mini blog-prompt__save"
                onClick={savePrompt}
                disabled={!promptDirty && !promptSaved}
              >
                {promptSaved ? "저장됨 ✓" : "저장"}
              </button>
            </div>
          </div>
          <textarea
            value={extraPrompt}
            onChange={(e) => setExtraPrompt(e.target.value)}
            rows={3}
            placeholder="검사·개선본에 반영할 요청을 적어주세요 (예: 무인매장 창업 초보 타깃으로, 점수를 더 엄격하게, 개선본은 3,000자 이상으로)"
          />
          <small className="blog-prompt__hint">
            저장하면 다음에 열 때·초기화 후에도 이 지시가 그대로 유지됩니다. (수정만 하고 저장 안 하면 이번 검사에만 적용)
          </small>
        </div>

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

      {result && (
        <BlogResultView
          data={result}
          feedbackLog={feedbackLog}
          reloading={reloading}
          onReanalyze={reanalyze}
          onCancel={cancel}
        />
      )}
    </>
  );
}

function BlogResultView({
  data,
  feedbackLog,
  reloading,
  onReanalyze,
  onCancel,
}: {
  data: BlogResult;
  feedbackLog: string[];
  reloading: boolean;
  onReanalyze: (feedback: string) => void;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState("");
  const [feedback, setFeedback] = useState("");
  async function doCopy(key: string, text: string) {
    const ok = await copyText(text);
    setCopied(ok ? key : `${key}:fail`);
    setTimeout(() => setCopied(""), ok ? 1200 : 2500);
  }
  function submitFeedback() {
    if (!feedback.trim() || reloading) return;
    onReanalyze(feedback);
    setFeedback("");
  }
  function copyLabel(key: string, idle: string, done = "복사됨 ✓") {
    if (copied === key) return done;
    if (copied === `${key}:fail`) return "복사 실패";
    return idle;
  }
  const fullImproved = (data.improvedTitle ? data.improvedTitle + "\n\n" : "") + (data.improvedBody || "");

  return (
    <section className="card blog-result">
      <div className="blog-recheck">
        <h3>💬 재검사 요청</h3>
        <p className="blog-recheck__hint">
          결과에서 더 원하는 점을 적으면 그 내용을 반영해 다시 검사합니다.
          (예: “점수를 더 엄격하게 봐줘”, “20대 여성 타깃으로”, “개선본을 더 짧고 캐주얼하게”)
        </p>
        {feedbackLog.length > 0 && (
          <ul className="blog-recheck__log">
            {feedbackLog.map((f, i) => (
              <li key={i}>“{f}”</li>
            ))}
          </ul>
        )}
        <textarea
          className="blog-recheck__input"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") submitFeedback();
          }}
          rows={2}
          placeholder="다시 검사할 때 반영할 내용을 적어주세요 (Ctrl+Enter 로 실행)"
          disabled={reloading}
        />
        <div className="blog-recheck__btns">
          <button
            className="blog-run blog-recheck__go"
            onClick={submitFeedback}
            disabled={reloading || !feedback.trim()}
          >
            {reloading ? "재검사 중…" : "이 내용으로 다시 검사"}
          </button>
          {reloading && (
            <button className="blog-cancel" onClick={onCancel}>
              ■ 중단
            </button>
          )}
        </div>
      </div>

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
              {copyLabel("all", "제목+본문 전체 복사")}
            </button>
          </div>
          {data.improvedTitle && (
            <div className="blog-improved__title-row">
              <div className="blog-improved__title">{data.improvedTitle}</div>
              <button className="blog-copy" onClick={() => doCopy("title", data.improvedTitle)}>
                {copyLabel("title", "제목 복사", "복사됨")}
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
            {copyLabel("body", "본문만 복사")}
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
                  {copyLabel(`t${i}`, "복사", "복사됨")}
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

function BlogGeneratePanel() {
  const [topic, setTopic] = useState("");
  const [genPrompt, setGenPrompt] = useState(DEFAULT_GEN_PROMPT);
  const [savedGenPrompt, setSavedGenPrompt] = useState(DEFAULT_GEN_PROMPT);
  const [genSaved, setGenSaved] = useState(false);
  const [promptOpen, setPromptOpen] = useState(true);
  const [model, setModel] = useState(BLOG_MODELS[0].id);
  const [images, setImages] = useState<BlogImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [lastInput, setLastInput] = useState<GenerateInput | null>(null);
  const [refineLog, setRefineLog] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // 저장해 둔 생성 지시문을 불러온다. 저장값이 없으면 기본 프롬프트를 채운다.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(GEN_PROMPT_KEY);
      const init = stored ?? DEFAULT_GEN_PROMPT;
      setGenPrompt(init);
      setSavedGenPrompt(init);
    } catch {
      /* 무시 */
    }
  }, []);

  // 모드 전환 등으로 언마운트되면 진행 중이던 요청을 중단한다.
  useEffect(() => () => abortRef.current?.abort(), []);

  const promptDirty = genPrompt !== savedGenPrompt;
  const isDefault = genPrompt === DEFAULT_GEN_PROMPT;

  function savePrompt() {
    try {
      localStorage.setItem(GEN_PROMPT_KEY, genPrompt);
    } catch {
      /* 무시 */
    }
    setSavedGenPrompt(genPrompt);
    setGenSaved(true);
    setTimeout(() => setGenSaved(false), 1500);
  }

  function toError(e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") setError("생성을 중단했습니다.");
    else setError(String(e instanceof Error ? e.message : e));
  }

  async function onPickImages(files: FileList | null) {
    if (!files) return;
    const picked: BlogImage[] = [];
    for (const f of Array.from(files)) {
      if (ALLOWED.includes(f.type)) picked.push(await fileToImage(f));
    }
    setImages((prev) => [...prev, ...picked].slice(0, 6));
  }

  async function generate() {
    if (topic.trim().length < 5) {
      setError("주제·매장 정보를 5자 이상 입력해 주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setRefineLog([]);
    const input: GenerateInput = {
      topic,
      systemPrompt: genPrompt.trim() || DEFAULT_GEN_PROMPT,
      images,
      model,
    };
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const r = await generateBlog(input, controller.signal);
      setResult(r);
      setLastInput(input);
    } catch (e) {
      toError(e);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  // 생성 결과에 이어서 요청(채팅)을 반영해 다시 쓰기
  async function refine() {
    const fb = feedback.trim();
    if (!fb || !lastInput || !result || reloading) return;
    setReloading(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const r = await generateBlog(
        { ...lastInput, feedback: fb, prevText: result.text },
        controller.signal
      );
      setResult(r);
      setRefineLog((prev) => [...prev, fb]);
      setFeedback("");
    } catch (e) {
      toError(e);
    } finally {
      setReloading(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  async function doCopy() {
    const ok = await copyText(result?.text || "");
    setCopied(true);
    setTimeout(() => setCopied(false), ok ? 1500 : 2500);
  }

  return (
    <>
      <section className="card blog-form">
        <h2 className="card__title">✍️ 블로그 글 생성 (방문 설치후기)</h2>
        <p className="card__desc">
          주제·매장 정보를 넣으면 저장된 <b>지시문(프롬프트)</b>대로 AI가 블로그 글 초안을 작성합니다.
        </p>

        <label className="blog-field">
          <span>주제 · 매장 정보 *</span>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={9}
            placeholder={
              "예)\n주제: OO동 무인 아이스크림 매장 키오스크 설치후기\n" +
              "- 매장 업종: 무인 아이스크림 할인점\n" +
              "- 설치 기종/구성: 스탠드형 키오스크 1대 + 카드결제기 + 영수증 프린터\n" +
              "- 방문 지역: 경기도 OO시\n- 설치 소요 시간: 약 2시간\n" +
              "- 특이사항: 전기 배선 위치 문제로 위치 조정 / 사장님 첫 창업\n" +
              "- 강조하고 싶은 점: 방문 설치의 편리함, 사후 관리"
            }
          />
          <small className="blog-count">{topic.length.toLocaleString()}자</small>
        </label>

        <div className="blog-field blog-prompt">
          <div className="blog-prompt__head">
            <button
              type="button"
              className="blog-prompt__toggle"
              onClick={() => setPromptOpen((v) => !v)}
              aria-expanded={promptOpen}
            >
              {promptOpen ? "▾" : "▸"} 생성 지시문(프롬프트) {isDefault ? "· 기본값" : "· 수정됨"}
              {!promptOpen && <span className="blog-prompt__cue"> — 클릭해 펼치기/편집</span>}
            </button>
            <div className="blog-prompt__actions">
              {promptDirty && <span className="blog-prompt__dirty">● 미저장</span>}
              {!isDefault && (
                <button type="button" className="blog-mini" onClick={() => setGenPrompt(DEFAULT_GEN_PROMPT)}>
                  기본값
                </button>
              )}
              {promptDirty && (
                <button type="button" className="blog-mini" onClick={() => setGenPrompt(savedGenPrompt)}>
                  저장값으로
                </button>
              )}
              <button
                type="button"
                className="blog-mini blog-prompt__save"
                onClick={savePrompt}
                disabled={!promptDirty && !genSaved}
              >
                {genSaved ? "저장됨 ✓" : "저장"}
              </button>
            </div>
          </div>
          {promptOpen && (
            <>
              <textarea
                value={genPrompt}
                onChange={(e) => setGenPrompt(e.target.value)}
                rows={16}
                spellCheck={false}
              />
              <small className="blog-prompt__hint">
                저장하면 이 브라우저에서 다음에 열 때도 그대로 유지됩니다. (수정만 하고 저장 안 하면 이번 생성에만 적용)
              </small>
            </>
          )}
        </div>

        <label className="blog-field">
          <span>생성 모델</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {BLOG_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>

        <label className="blog-field">
          <span>사진 첨부 (선택, 최대 6장)</span>
          <input type="file" accept="image/*" multiple onChange={(e) => onPickImages(e.target.files)} />
          <small className="blog-prompt__hint">
            사진을 넣으면 본문에 <b>(사진: 파일명)</b> 형식으로 들어갈 위치를 표시해 줍니다. 파일명을 알아보기 쉽게 지어두면 좋아요.
          </small>
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
          <button className="blog-run" onClick={generate} disabled={loading}>
            {loading ? "생성 중… (모델에 따라 최대 1분)" : "글 생성하기"}
          </button>
          {loading && (
            <button className="blog-cancel" onClick={cancel}>
              ■ 생성 중단
            </button>
          )}
        </div>
      </section>

      {result && (
        <section className="card blog-result">
          <div className="blog-recheck">
            <h3>💬 이어서 요청</h3>
            <p className="blog-recheck__hint">
              결과에서 더 원하는 점을 적으면 그 내용을 반영해 다시 씁니다.
              (예: “도입부를 더 짧게”, “체크리스트를 표로”, “사후관리 부분을 더 자세히”)
            </p>
            {refineLog.length > 0 && (
              <ul className="blog-recheck__log">
                {refineLog.map((f, i) => (
                  <li key={i}>“{f}”</li>
                ))}
              </ul>
            )}
            <textarea
              className="blog-recheck__input"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") refine();
              }}
              rows={2}
              placeholder="다시 쓸 때 반영할 내용을 적어주세요 (Ctrl+Enter 로 실행)"
              disabled={reloading}
            />
            <div className="blog-recheck__btns">
              <button
                className="blog-run blog-recheck__go"
                onClick={refine}
                disabled={reloading || !feedback.trim()}
              >
                {reloading ? "다시 쓰는 중…" : "이 내용으로 다시 쓰기"}
              </button>
              {reloading && (
                <button className="blog-cancel" onClick={cancel}>
                  ■ 중단
                </button>
              )}
            </div>
          </div>

          <div className="blog-block blog-improved">
            <div className="blog-improved__head">
              <h3>✨ 생성된 글 — 복사해서 사용</h3>
              <button className="blog-run blog-copy-all" onClick={doCopy}>
                {copied ? "복사됨 ✓" : "전체 복사"}
              </button>
            </div>
            <textarea
              className="blog-improved__body"
              readOnly
              value={result.text}
              rows={Math.min(40, Math.max(12, result.text.split("\n").length + 2))}
              onFocus={(e) => e.target.select()}
            />
          </div>

          {result.cost && (
            <p className="blog-cost">
              이번 생성 비용: 약 <b>{result.cost.krw.toLocaleString()}원</b> · 토큰 입력{" "}
              {result.cost.inputTokens.toLocaleString()} / 출력 {result.cost.outputTokens.toLocaleString()}
              {result.usedModel ? ` · ${result.usedModel}` : ""}
            </p>
          )}
        </section>
      )}
    </>
  );
}
