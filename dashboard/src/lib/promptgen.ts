// 프롬프트 생성기 — 데이터 레이어
// 결과물은 콘텐츠(글)가 아니라, AI 채팅창(ChatGPT·Claude 등)에 그대로 붙여넣어
// 반복 사용하는 '완성된 지시문(프롬프트)'이다.

export interface PromptResult {
  prompt: string; // 붙여넣어 쓰는 완성 지시문
  usedModel?: string;
  cost?: { inputTokens: number; outputTokens: number; usd: number; krw: number };
}

export interface GeneratePromptInput {
  topic: string; // 분야/주제
  deliverables: string[]; // 만들 산출물(blog·video·instagram·tiktok·naver)
  audience?: string; // 타겟 독자(선택)
  persona?: string; // 역할/말투(선택)
  extra?: string; // 추가 지침(선택)
  model?: string;
}

// 만들 산출물 — 어떤 콘텐츠를 위한 프롬프트인지
export const DELIVERABLES: { id: string; label: string; icon: string }[] = [
  { id: "blog", label: "블로그 게시글", icon: "📝" },
  { id: "video", label: "유튜브 영상 스크립트", icon: "▶️" },
  { id: "instagram", label: "인스타그램", icon: "📷" },
  { id: "tiktok", label: "틱톡·숏폼", icon: "🎵" },
  { id: "naver", label: "네이버 블로그(SEO)", icon: "🟢" },
];

// 블로그 검사기와 동일한 모델 라인업 재사용
export const PROMPT_MODELS = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 — 균형 (추천)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — 저렴·빠름" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 — 정확" },
];

export async function generatePrompt(
  input: GeneratePromptInput,
  signal?: AbortSignal
): Promise<PromptResult> {
  const res = await fetch("/api/prompt-generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  const text = await res.text();
  let body: { error?: string } & Partial<PromptResult>;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      "데이터 서버(BFF)에 연결할 수 없습니다. BFF가 실행 중인지 확인하세요 (포트 8787). " +
        "실행.bat 으로 화면·서버를 함께 켜거나, `node server/notion-sales-bff.mjs` 를 실행하세요."
    );
  }
  if (!res.ok) throw new Error(body?.error || `생성 실패: ${res.status}`);
  return body as PromptResult;
}
