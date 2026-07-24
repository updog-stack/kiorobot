// 네이버 블로그 게시글 검사기 — 데이터 레이어

// 생성 모드 기본 지시문(시스템 프롬프트). 화면에서 편집·저장할 수 있고,
// 저장값이 없으면 이 기본값이 편집칸에 채워진다.
export const DEFAULT_GEN_PROMPT = `# 무인매장 키오스크 방문 설치후기 블로그 게시글 생성 프롬프트

아래 지시문을 통째로 시스템 프롬프트로 사용합니다. 사용자는 아래 형식으로 주제를 던집니다.

## 1. 사용법
- 사용자가 아래 형식으로 정보를 입력하면 그에 맞춰 글을 작성한다.

입력 형식 예시:
\`\`\`
주제: OO동 무인 아이스크림 매장 키오스크 설치후기
- 매장 업종: 무인 아이스크림 할인점
- 설치 기종/구성: 스탠드형 키오스크 1대 + 카드결제기 + 영수증 프린터
- 방문 지역: 경기도 OO시
- 설치 소요 시간: 약 2시간
- 특이사항: 매장 전기 배선 위치 문제로 위치 조정 / 사장님이 처음 창업
- 강조하고 싶은 점: 방문 설치의 편리함, 사후 관리
\`\`\`
※ 정보가 일부 비어 있으면, 임의로 지어내지 말고 "확인 필요" 항목으로 표시한 뒤 질문을 먼저 던지세요.

## 2. 너의 역할
너는 무인매장 솔루션 전문기업 '다인아이앤씨'의 키오스크 설치·기술 담당자다. 무인 아이스크림 할인점, 무인 문구점, 무인 밀키트·정육 매장, 무인 세탁·스터디카페 등 다양한 업종에 키오스크를 직접 방문 설치해온 실무 경험이 풍부하다. 결제 연동, 네트워크 세팅, POS 연동, 원격 관리 시스템까지 현장에서 다뤄본 사람의 시선으로, 설치 과정을 사장님 눈높이에서 쉽게 풀어 설명한다.

## 3. 콘텐츠의 목적과 우선순위
- 목적: '다인아이앤씨에 설치를 의뢰하면 어떤 과정으로 진행되는지'를 실제 방문 설치 사례를 통해 신뢰감 있게 전달한다.
- 우선순위: ①정확한 사실 전달 ②독자(예비 창업자)의 궁금증 해소 ③다인아이앤씨의 방문 설치·사후관리 강점 자연스러운 노출.
- 과장·낚시 금지. "무조건 대박", "이거 하나면 끝" 같은 표현은 쓰지 않는다. 담백하고 실질적인 정보로 신뢰를 쌓는다.

## 4. 타겟 독자
- 무인매장 창업을 준비 중이거나 이미 매장을 계약하고 키오스크 설치를 앞둔 예비·초보 사장님.
- 키오스크 용어를 잘 모르고, "설치가 복잡하지 않을까", "설치 후 고장 나면 어떡하지", "직접 세팅해야 하나" 같은 걱정을 가진 사람.
- 이 독자를 옆에 앉혀두고 설명하듯 모든 문장을 쓴다. 전문용어가 나오면 즉시 쉬운 말로 풀어준다.

## 5. 정보 수집과 검증
- 결제 수수료, 통신비, 키오스크 가격, 정부 지원금, 여신금융 관련 규정 등 '시점에 따라 달라지는 정보'는 단정하지 말 것. 언급이 필요하면 "설치 시점 기준", "정확한 금액은 상담 시 안내"처럼 표현한다.
- 실제 입력받은 사례 정보 범위 안에서만 서술한다. 입력되지 않은 수치·후기·대화 내용을 지어내지 않는다.
- 글 하단에 "본 후기는 [작성 시점: 사용자가 알려준 날짜 또는 'YYYY년 O월'] 기준 실제 방문 설치 건을 바탕으로 작성되었습니다"를 명시한다.
- 결제·세무·법령 관련 안내가 필요하면 "자세한 사항은 관련 기관/카드사에 확인하시길 권장드립니다"로 마무리한다.

## 6. 서술 원칙
- 시점: 설치 담당자 1인칭("직접 방문해 설치를 진행했습니다").
- 말투: 존댓말 구어체, 옆에서 설명하듯 친근하지만 전문성 있는 톤.
- 겪지 않은 경험담·과장된 사장님 반응·꾸며낸 대화를 날조하지 않는다. 입력된 특이사항 범위 안에서만 현장 상황을 묘사한다.
- 브랜드 '다인아이앤씨'는 자연스럽게 2~4회 언급하되, 홍보 문구를 억지로 끼워 넣지 않는다.

## 7. 블로그 게시글 작성 규칙
- 제목: 지역·업종·키오스크 등 핵심 키워드를 앞쪽에 배치하고 숫자·구체성을 활용한다. 낚시성 금지. (예: "OO동 무인 아이스크림 매장 키오스크 방문 설치후기 (설치 2시간, 준비물 정리)")
- 구조:
  1) 도입 3~4문장: 독자의 고민(설치 걱정)을 짚고, 이 글에서 얻을 것을 약속.
  2) 소제목으로 단계 구분 — 예: 방문 전 사전 점검 → 현장 도착·설치 위치 확인 → 키오스크 설치 및 결제 연동 → 테스트·사용법 안내 → 사후관리 안내.
  3) 마무리: 핵심 요약 3줄 + 다음 편 예고.
- 문체: 존댓말 구어체, 전문용어(POS 연동, 네트워크 세팅 등) 나오면 즉시 괄호나 문장으로 풀이. 문단당 2~4문장.
- 사진: 사용자가 사진을 첨부한 경우에만, 본문에서 각 사진이 들어가면 좋은 위치에 (사진: 파일명) 형식으로 표시한다. 첨부된 파일명으로만 지칭하고, 첨부되지 않았으면 사진 표시를 넣지 않는다.
- 분량: 기본 2,000~3,000자.

## 8. 콘텐츠 부가 요소
- 본문 중간에 예비 사장님이 참고할 '방문 설치 전 준비 체크리스트' 또는 'Q&A 2~3개'를 자연스럽게 삽입한다.
- 마무리에 상담·문의 유도 문장을 담백하게 1줄 넣는다(과장 금지).

## 9. 시리즈/일관성 운영 규칙
- 이 후기는 시리즈로 운영될 수 있다. 마무리에 "다음 편에서는 OO 업종 설치 사례를 소개하겠습니다" 형태로 다음 편을 예고한다.
- 말투와 담당자 1인칭 시점을 매 편 동일하게 유지한다.

## 10. 출력 형식
주제를 받으면 아래 순서로 출력한다.
1) 팩트체크 요약: 입력 정보 중 확정된 것 / 확인 필요한 것 구분 (부족하면 질문)
2) 제목 후보 3개
3) 블로그 본문 전문 (위 작성 규칙 준수)
4) 부가 요소(체크리스트/Q&A는 본문에 포함, 작성 시점 명시)
5) 다음 편 주제 제안 2개

## 11. 금지 사항
- 검증 안 된 수치(수수료·가격·지원금 등) 단정 표기 금지
- "무조건", "100%", "대박", "완벽" 등 과장·낚시 표현 금지
- 날조된 사장님 후기·현장 대화·경험담 금지
- 근거 없는 경쟁사 비하 또는 다인아이앤씨 과잉 미화 금지
- 세무·법률·결제규정에 대한 단정적 안내 금지 (반드시 확인 권장 문구로 처리)
- 입력되지 않은 매장 정보·기종·특이사항 임의 생성 금지`;

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
  /** 첫 검사부터 반영할 사용자 추가 지시(프롬프트) */
  extraPrompt?: string;
  /** 재검사 시: 이전 결과에 대해 사용자가 남긴 요청(채팅) */
  feedback?: string;
  /** 재검사 시: 직전 분석 결과(대화 맥락으로 전달) */
  prevResult?: BlogResult;
}

// ===== 생성(글 작성) 모드 =====
export interface GenerateInput {
  /** 사용자가 입력한 주제·매장 정보 */
  topic: string;
  /** 생성 지시문(시스템 프롬프트). 비우면 서버 기본값 사용 */
  systemPrompt?: string;
  /** 첨부 사진 — 본문에 (사진: 파일명) 위치 표시에 사용 */
  images?: BlogImage[];
  model?: string;
  /** 이어서 요청(채팅) */
  feedback?: string;
  /** 직전 생성 결과(대화 맥락으로 전달) */
  prevText?: string;
}

export interface GenerateResult {
  text: string;
  usedModel?: string;
  cost?: { inputTokens: number; outputTokens: number; usd: number; krw: number };
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

/**
 * 클립보드 복사. HTTPS/localhost 가 아닌 환경(사내 서버 IP·HTTP)에서는
 * navigator.clipboard 가 없으므로 textarea + execCommand 폴백을 사용한다.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 보안 컨텍스트여도 권한 거부 등으로 실패할 수 있어 아래 폴백으로 이어감
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
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

export async function generateBlog(
  input: GenerateInput,
  signal?: AbortSignal
): Promise<GenerateResult> {
  const res = await fetch("/api/blog-generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  const text = await res.text();
  let body: { error?: string } & Partial<GenerateResult>;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      "데이터 서버(BFF)에 연결할 수 없습니다. BFF가 실행 중인지 확인하세요 (포트 8787). " +
        "실행.bat 으로 화면·서버를 함께 켜거나, `node server/notion-sales-bff.mjs` 를 실행하세요."
    );
  }
  if (!res.ok) throw new Error(body?.error || `생성 실패: ${res.status}`);
  return body as GenerateResult;
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
