// 네이버 블로그 게시글 검사기 — 데이터 레이어

export interface BlogIssue {
  severity: "high" | "medium" | "low";
  location: string;
  problem: string;
  suggestion: string;
}

export interface BlogResult {
  overallScore: number;
  summary: string;
  mainKeyword: string;
  titleFeedback: { score: number; comment: string };
  issues: BlogIssue[];
  strengths: string[];
  rewrittenTitleSuggestions: string[];
  improvedTitle: string;
  improvedBody: string;
  usedModel?: string;
  cost?: { inputTokens: number; outputTokens: number; usd: number; krw: number };
}

export interface BlogImage {
  name: string;
  mediaType: string;
  data: string; // base64 (without data: prefix)
}

export interface AnalyzeInput {
  title: string;
  body: string;
  images?: BlogImage[];
  model?: string;
  kioskModel?: string;
}

export const BLOG_MODELS = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 — 균형 (추천)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — 저렴·빠름" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 — 정확" },
];

export const SEVERITY: Record<
  string,
  { label: string; cls: string }
> = {
  high: { label: "심각", cls: "blog-sev--high" },
  medium: { label: "보통", cls: "blog-sev--medium" },
  low: { label: "참고", cls: "blog-sev--low" },
};

export function scoreColor(s: number): string {
  return s >= 80 ? "#059669" : s >= 60 ? "#d97706" : "#dc2626";
}

export async function analyzeBlog(
  input: AnalyzeInput,
  signal?: AbortSignal
): Promise<BlogResult> {
  const res = await fetch("/api/blog-analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  // 서버가 JSON이 아닌 HTML(예: BFF 미실행 시 화면 페이지)을 주는 경우를 친절히 처리
  const text = await res.text();
  let body: { error?: string } & Partial<BlogResult>;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      "데이터 서버(BFF)에 연결할 수 없습니다. BFF가 실행 중인지 확인하세요 (포트 8787). " +
        "실행.bat 으로 화면·서버를 함께 켜거나, `node server/notion-sales-bff.mjs` 를 실행하세요."
    );
  }
  if (!res.ok) throw new Error(body?.error || `분석 실패: ${res.status}`);
  return body as BlogResult;
}

// File → base64 BlogImage
export function fileToImage(file: File): Promise<BlogImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve({
        name: file.name,
        mediaType: file.type,
        data: dataUrl.split(",")[1] || "",
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
