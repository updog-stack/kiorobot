// 대표님 보고용 "전체 현황" 지표 데이터.
// 장비매출 / CMS매출 / VAN건수는 스프레드시트 예시값(2026 vs 2025),
// 그 외(CS·콘텐츠·매출구성·사업자)는 임의(샘플) 데이터입니다.

export const YEAR = 2026;
export const PREV_YEAR = 2025;

export type Unit = "won" | "count" | "views";

export interface Mseries {
  key: string;
  label: string;
  unit: Unit;
  cur: number[]; // 올해(2026) 월별 — 데이터가 있는 달까지만 (1월부터)
  prev: number[]; // 작년(2025) 월별 — 길이 12 (없으면 0)
  sample?: boolean; // 임의 데이터 여부
}

// ===== 매출 (단위: 원) — 스프레드시트 예시값 =====
export const equipment: Mseries = {
  key: "equipment",
  label: "장비 매출",
  unit: "won",
  cur: [16_287_000, 26_724_850, 42_456_116, 37_301_898, 24_248_999, 11_539_000],
  prev: [
    14_661_128, 28_840_600, 64_195_304, 30_994_356, 62_243_000, 26_414_000,
    31_340_000, 61_348_300, 42_416_999, 27_004_500, 46_028_600, 9_873_000,
  ],
};

export const cms: Mseries = {
  key: "cms",
  label: "CMS 매출",
  unit: "won",
  // 1~4월은 예시값, 5~6월은 임의값
  cur: [11_405_900, 11_235_400, 11_367_400, 11_708_400, 11_612_000, 5_840_000],
  prev: [
    9_121_750, 9_425_250, 10_161_250, 10_371_350, 10_751_650, 11_065_150,
    10_663_650, 11_048_650, 11_529_650, 11_661_650, 11_504_950, 11_515_900,
  ],
};

// ===== VAN 거래 건수 (단위: 건) — 스프레드시트 예시값 =====
export const daou: Mseries = {
  key: "daou",
  label: "DAOU",
  unit: "count",
  cur: [442_197, 415_516, 584_800, 658_997, 692_966],
  prev: [
    477_439, 445_615, 576_930, 651_593, 656_574, 713_077, 708_395, 670_998,
    666_765, 573_857, 531_457, 0,
  ],
};

export const kovan: Mseries = {
  key: "kovan",
  label: "KOVAN",
  unit: "count",
  cur: [221_913, 187_555, 158_459, 157_533, 168_042],
  prev: [
    254_447, 234_368, 281_788, 299_375, 322_052, 334_595, 353_322, 339_945,
    316_983, 296_625, 260_309, 0,
  ],
};

export const kicc: Mseries = {
  key: "kicc",
  label: "KICC",
  unit: "count",
  cur: [17_204, 15_582, 16_183, 17_973, 14_465],
  prev: [
    45_146, 43_496, 46_182, 53_299, 50_944, 51_047, 38_447, 32_058, 24_456,
    23_413, 21_731, 0,
  ],
};

// ===== CS 처리 건수 (임의) =====
export const cs: Mseries = {
  key: "cs",
  label: "CS 처리 건수",
  unit: "count",
  sample: true,
  cur: [1_240, 1_180, 1_320, 1_290, 1_410, 690],
  prev: [1_100, 1_050, 1_230, 1_190, 1_280, 1_350, 1_400, 1_330, 1_210, 1_150, 1_080, 990],
};

// ===== 콘텐츠 (임의) =====
export const contentViews: Mseries = {
  key: "views",
  label: "콘텐츠 조회수",
  unit: "views",
  sample: true,
  cur: [42_000, 51_000, 38_000, 47_000, 55_000, 24_000],
  prev: [30_000, 33_000, 36_000, 41_000, 38_000, 44_000, 46_000, 40_000, 37_000, 35_000, 32_000, 28_000],
};

export const contentPubs: Mseries = {
  key: "pubs",
  label: "콘텐츠 발행량",
  unit: "count",
  sample: true,
  cur: [12, 15, 11, 14, 16, 7],
  prev: [8, 9, 10, 11, 9, 12, 13, 10, 11, 9, 8, 7],
};

// ===== 매출 구성 (임의, 단위: 원) =====
export const newCard: Mseries = {
  key: "newcard",
  label: "신규 카드가맹",
  unit: "won",
  sample: true,
  cur: [3_200_000, 4_100_000, 3_800_000, 4_500_000, 3_900_000, 2_050_000],
  prev: [2_800_000, 3_100_000, 4_500_000, 3_300_000, 4_800_000, 3_900_000, 3_500_000, 4_200_000, 3_700_000, 2_900_000, 3_400_000, 2_600_000],
};

export const license: Mseries = {
  key: "license",
  label: "라이센스",
  unit: "won",
  sample: true,
  cur: [5_400_000, 4_900_000, 6_100_000, 5_600_000, 5_200_000, 2_750_000],
  prev: [4_800_000, 5_100_000, 5_500_000, 4_900_000, 6_200_000, 5_400_000, 5_000_000, 5_800_000, 5_300_000, 4_600_000, 5_200_000, 4_100_000],
};

export const reinstall: Mseries = {
  key: "reinstall",
  label: "이전설치",
  unit: "won",
  sample: true,
  cur: [1_800_000, 2_100_000, 1_600_000, 2_400_000, 1_900_000, 920_000],
  prev: [1_500_000, 1_700_000, 2_000_000, 1_800_000, 2_200_000, 1_900_000, 1_750_000, 2_050_000, 1_850_000, 1_600_000, 1_700_000, 1_300_000],
};

// ===== 사업자 현황 (임의, 단위: 건) — 상반기 =====
export const newBiz: Mseries = {
  key: "newbiz",
  label: "신규 사업자",
  unit: "count",
  sample: true,
  cur: [320, 290, 350, 310, 340, 170],
  prev: [280, 260, 300, 270, 310, 290, 300, 280, 260, 250, 240, 230],
};

export const closedBiz: Mseries = {
  key: "closedbiz",
  label: "폐업 사업자",
  unit: "count",
  sample: true,
  cur: [140, 160, 130, 150, 120, 65],
  prev: [110, 130, 120, 140, 100, 125, 130, 120, 115, 110, 105, 100],
};

// ===== 헬퍼 =====
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export function zipSum(list: Mseries[], pick: "cur" | "prev"): number[] {
  const len = Math.max(...list.map((s) => s[pick].length));
  return Array.from({ length: len }, (_, i) =>
    sum(list.map((s) => s[pick][i] ?? 0))
  );
}

// VAN 3사 합산
export const van: Mseries = {
  key: "van",
  label: "VAN 거래 건수",
  unit: "count",
  cur: zipSum([daou, kovan, kicc], "cur"),
  prev: zipSum([daou, kovan, kicc], "prev"),
};

export interface Ytd {
  cur: number; // 올해 누적
  prev: number; // 작년 동기간(같은 개월 수) 누적
  prevFull: number; // 작년 연간 누적
  months: number; // 올해 데이터가 있는 개월 수
}

export function ytd(s: Mseries): Ytd {
  const n = s.cur.length;
  return {
    cur: sum(s.cur),
    prev: sum(s.prev.slice(0, n)),
    prevFull: sum(s.prev),
    months: n,
  };
}

// 단위별 표기 (won은 format.ts의 won() 사용)
export function fmtCount(n: number, unit: Unit): string {
  const v = Math.round(n).toLocaleString("ko-KR");
  return unit === "views" ? `${v}회` : `${v}건`;
}

// ===== 경영지표 분석: 월별 동월대비 + 연말 예상 =====
export type Tone = "up" | "down" | "flat" | "muted";

export interface MonthYoY {
  month: number;
  cur: number;
  prev: number; // 작년 동월
  pct: number | null; // 동월 대비 증감율(%)
  tone: Tone;
}

// 올해 각 월을 작년 같은 달과 비교
export function monthlyYoY(s: Mseries): MonthYoY[] {
  return s.cur.map((cur, i) => {
    const prev = s.prev[i] ?? 0;
    const pct = prev > 0 ? ((cur - prev) / prev) * 100 : null;
    const tone: Tone =
      pct == null ? "muted" : pct > 0.5 ? "up" : pct < -0.5 ? "down" : "flat";
    return { month: i + 1, cur, prev, pct, tone };
  });
}

export interface Forecast {
  ytdCur: number; // 올해 누적
  ytdPrev: number; // 작년 동기 누적
  prevFull: number; // 작년 연간
  months: number; // 경과 개월
  growthRatio: number | null; // 올해/작년 동기 비율
  forecast: number; // 연말 예상
  vsPrevFull: number | null; // 예상 vs 작년연간 증감율(%)
}

// ===== 점수화: 작년(동기) = 100점 =====
export type Band = "good" | "warn" | "bad" | "na";

export interface Scorecard {
  ytdScore: number | null; // 작년 동기 대비 점수(=100 기준)
  yearEndScore: number | null; // 연말 예상 점수(작년 연간 대비)
  band: Band; // ytdScore 색 구간
  grade: string; // 등급 라벨
  remaining: number; // 남은 개월
  neededRemaining: number; // 작년 연간 따라잡기 위해 남은 기간 필요 합계
  neededPerMonth: number; // 그 월평균
  recentAvg: number; // 현재 월평균
  upliftPct: number | null; // 월평균을 얼마나 더 올려야(%)
  onTrack: boolean; // 연말 예상이 작년 연간 이상
}

export function bandOf(score: number | null): Band {
  if (score == null) return "na";
  if (score >= 100) return "good";
  if (score >= 85) return "warn";
  return "bad";
}
export function gradeOf(score: number | null): string {
  if (score == null) return "평가불가";
  if (score >= 110) return "탁월";
  if (score >= 100) return "양호";
  if (score >= 90) return "주의";
  if (score >= 80) return "미흡";
  return "부진";
}

export function scorecard(s: Mseries): Scorecard {
  const f = forecast(s);
  const ytdScore = f.ytdPrev > 0 ? (f.ytdCur / f.ytdPrev) * 100 : null;
  const yearEndScore = f.prevFull > 0 ? (f.forecast / f.prevFull) * 100 : null;
  const remaining = Math.max(0, 12 - f.months);
  const neededRemaining = Math.max(0, f.prevFull - f.ytdCur);
  const neededPerMonth = remaining > 0 ? neededRemaining / remaining : 0;
  const recentAvg = f.months > 0 ? f.ytdCur / f.months : 0;
  const upliftPct = recentAvg > 0 ? (neededPerMonth / recentAvg - 1) * 100 : null;
  return {
    ytdScore,
    yearEndScore,
    band: bandOf(ytdScore),
    grade: gradeOf(ytdScore),
    remaining,
    neededRemaining,
    neededPerMonth,
    recentAvg,
    upliftPct,
    onTrack: (yearEndScore ?? 0) >= 100,
  };
}

// 연말 예상 — 작년 계절성(잔여월 패턴)에 올해 누적 성장률을 곱해 추정
export function forecast(s: Mseries): Forecast {
  const n = s.cur.length;
  const ytdCur = sum(s.cur);
  const ytdPrev = sum(s.prev.slice(0, n));
  const prevFull = sum(s.prev);
  const growthRatio = ytdPrev > 0 ? ytdCur / ytdPrev : null;

  let projected = ytdCur;
  if (growthRatio != null) {
    // 남은 달(n..11)은 작년 같은 달 × 올해 성장률
    for (let m = n; m < s.prev.length; m++)
      projected += (s.prev[m] ?? 0) * growthRatio;
  } else if (n > 0) {
    projected = (ytdCur / n) * 12; // 작년값 없으면 단순 런레이트
  }
  const fc = Math.round(projected);
  return {
    ytdCur,
    ytdPrev,
    prevFull,
    months: n,
    growthRatio,
    forecast: fc,
    vsPrevFull: prevFull > 0 ? ((fc - prevFull) / prevFull) * 100 : null,
  };
}
