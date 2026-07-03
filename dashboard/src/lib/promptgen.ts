// 프롬프트 생성기 — 데이터 레이어
// 주제/키워드를 넣으면 플랫폼별 노출용 완성 콘텐츠(제목·설명·해시태그)를 생성한다.

export interface PlatformContent {
  platform: string; // "youtube" | "instagram" | "tiktok"
  label: string; // "유튜브" 등
  titles: string[]; // 제목/후킹 후보
  body: string; // 설명문/캡션
  hashtags: string[]; // # 포함
  tags: string[]; // 검색 태그(# 없음, 유튜브 위주)
  tips: string[]; // 노출 팁
}

export interface ContentResult {
  results: PlatformContent[];
  usedModel?: string;
  cost?: { inputTokens: number; outputTokens: number; usd: number; krw: number };
}

export interface GenerateInput {
  topic: string;
  platforms: string[];
  tone?: string;
  extra?: string;
  model?: string;
}

// 화면에서 고를 수 있는 대상 플랫폼
export const PLATFORMS: { id: string; label: string; icon: string }[] = [
  { id: "youtube", label: "유튜브", icon: "▶️" },
  { id: "instagram", label: "인스타그램", icon: "📷" },
  { id: "tiktok", label: "틱톡·스레드", icon: "🎵" },
  { id: "naver", label: "네이버 블로그", icon: "🟢" },
];

export const TONES: { id: string; label: string }[] = [
  { id: "hook", label: "후킹·클릭유도형 (추천)" },
  { id: "info", label: "정보전달·신뢰형" },
  { id: "friendly", label: "친근한 말투" },
  { id: "promo", label: "제품·이벤트 홍보형" },
];

// 블로그 검사기와 동일한 모델 라인업 재사용
export const CONTENT_MODELS = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 — 균형 (추천)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — 저렴·빠름" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 — 정확" },
];

export async function generateContent(
  input: GenerateInput,
  signal?: AbortSignal
): Promise<ContentResult> {
  const res = await fetch("/api/content-generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  const text = await res.text();
  let body: { error?: string } & Partial<ContentResult>;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      "데이터 서버(BFF)에 연결할 수 없습니다. BFF가 실행 중인지 확인하세요 (포트 8787). " +
        "실행.bat 으로 화면·서버를 함께 켜거나, `node server/notion-sales-bff.mjs` 를 실행하세요."
    );
  }
  if (!res.ok) throw new Error(body?.error || `생성 실패: ${res.status}`);
  return body as ContentResult;
}
