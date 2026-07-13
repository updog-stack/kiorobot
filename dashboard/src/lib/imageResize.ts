// 이미지 리사이저 — 브라우저(Canvas) 처리 로직
// 데스크톱 파이썬 프로그램(core/processor.py)의 동작을 웹으로 옮긴 것:
//   축소: 고품질 다운스케일(단계적 반감) + 미세 언샤프
//   확대: 단계적 2배 업스케일 + 언샤프(선명화)  (AI 업스케일은 upscaleAI로 별도)
//   비율이 다르면 중앙 크롭(cover)
//   출력 JPG/PNG/WEBP + 품질

export type ResizeMode = "pixel" | "percent" | "width" | "height";
export type OutFormat = "JPG" | "PNG" | "WEBP";
export type UpscaleMethod = "algorithm" | "ai"; // ai = UpscalerJS

export interface ResizeOptions {
  mode: ResizeMode;
  valueW: number;
  valueH: number;
  valuePct: number;
  keepRatio: boolean;
  outFmt: OutFormat;
  quality: number; // 1~100 (JPG/WEBP)
  upscaleMethod: UpscaleMethod;
}

export interface SourceImage {
  name: string;
  bitmap: ImageBitmap;
  width: number;
  height: number;
  bytes: number;
  previewUrl: string; // 원본 미리보기용 objectURL (대기 중에도 표시)
}

export interface ResizeResult {
  name: string; // 출력 파일명(확장자 포함)
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
  url: string; // objectURL (미리보기/다운로드용)
}

const MIME: Record<OutFormat, string> = {
  JPG: "image/jpeg",
  PNG: "image/png",
  WEBP: "image/webp",
};
const EXT: Record<OutFormat, string> = { JPG: ".jpg", PNG: ".png", WEBP: ".webp" };

export const READ_ACCEPT = "image/*,.heic,.heif";

// ── 목표 크기 계산 (processor.calc_target_size) ──
export function calcTargetSize(
  ow: number,
  oh: number,
  o: Pick<ResizeOptions, "mode" | "valueW" | "valueH" | "valuePct" | "keepRatio">
): { tw: number; th: number } {
  const { mode, valueW, valueH, valuePct, keepRatio } = o;
  if (mode === "percent") {
    const r = valuePct / 100;
    return { tw: Math.max(1, Math.round(ow * r)), th: Math.max(1, Math.round(oh * r)) };
  }
  if (mode === "width") {
    const tw = Math.max(1, valueW);
    const th = keepRatio ? Math.max(1, Math.round((oh * tw) / ow)) : Math.max(1, valueH);
    return { tw, th };
  }
  if (mode === "height") {
    const th = Math.max(1, valueH);
    const tw = keepRatio ? Math.max(1, Math.round((ow * th) / oh)) : Math.max(1, valueW);
    return { tw, th };
  }
  // pixel
  return { tw: Math.max(1, valueW), th: Math.max(1, valueH) };
}

function canvasOf(w: number, h: number): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: false })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { cv, ctx };
}

// 언샤프 마스크 (PIL UnsharpMask 근사) — radius는 blur 반경, amount는 강도(%)
function unsharp(cv: HTMLCanvasElement, radius: number, amount: number): HTMLCanvasElement {
  const w = cv.width;
  const h = cv.height;
  const ctx = cv.getContext("2d")!;
  const orig = ctx.getImageData(0, 0, w, h);

  // 블러 버전 생성 (canvas filter blur)
  const { ctx: bctx } = canvasOf(w, h);
  bctx.filter = `blur(${radius}px)`;
  bctx.drawImage(cv, 0, 0);
  const blur = bctx.getImageData(0, 0, w, h);

  const o = orig.data;
  const b = blur.data;
  const k = amount / 100;
  for (let i = 0; i < o.length; i += 4) {
    // sharpened = orig + amount*(orig - blur)  (RGB만, 알파 유지)
    o[i] = clamp(o[i] + k * (o[i] - b[i]));
    o[i + 1] = clamp(o[i + 1] + k * (o[i + 1] - b[i + 1]));
    o[i + 2] = clamp(o[i + 2] + k * (o[i + 2] - b[i + 2]));
  }
  ctx.putImageData(orig, 0, 0);
  return cv;
}
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

// 고품질 다운스케일: 한 번에 절반씩 줄여 계단현상 억제 (browser Lanczos 근사)
function drawDownscale(src: CanvasImageSource, sw: number, sh: number, tw: number, th: number): HTMLCanvasElement {
  let curW = sw;
  let curH = sh;
  let { cv, ctx } = canvasOf(curW, curH);
  ctx.drawImage(src, 0, 0, curW, curH);
  // 목표보다 2배 이상 크면 절반씩 축소
  while (curW * 0.5 > tw && curH * 0.5 > th) {
    const nw = Math.max(tw, Math.round(curW * 0.5));
    const nh = Math.max(th, Math.round(curH * 0.5));
    const next = canvasOf(nw, nh);
    next.ctx.drawImage(cv, 0, 0, curW, curH, 0, 0, nw, nh);
    cv = next.cv;
    ctx = next.ctx;
    curW = nw;
    curH = nh;
  }
  if (curW !== tw || curH !== th) {
    const fin = canvasOf(tw, th);
    fin.ctx.drawImage(cv, 0, 0, curW, curH, 0, 0, tw, th);
    cv = fin.cv;
  }
  return unsharp(cv, 0.5, 90);
}

// 단계적 업스케일 (processor._upscale_progressive): 2배씩 + 언샤프
function drawUpscaleProgressive(src: CanvasImageSource, sw: number, sh: number, tw: number, th: number): HTMLCanvasElement {
  let { cv } = canvasOf(sw, sh);
  cv.getContext("2d")!.drawImage(src, 0, 0, sw, sh);
  let curW = sw;
  let curH = sh;
  while (curW < tw * 0.75 || curH < th * 0.75) {
    const nw = Math.min(curW * 2, tw);
    const nh = Math.min(curH * 2, th);
    const next = canvasOf(nw, nh);
    next.ctx.drawImage(cv, 0, 0, curW, curH, 0, 0, nw, nh);
    cv = unsharp(next.cv, 0.9, 110);
    curW = nw;
    curH = nh;
  }
  if (curW !== tw || curH !== th) {
    const fin = canvasOf(tw, th);
    fin.ctx.drawImage(cv, 0, 0, curW, curH, 0, 0, tw, th);
    cv = fin.cv;
  }
  return unsharp(cv, 1.2, 130);
}

// 비율이 2% 이상 다르면 크롭 필요 (processor._needs_crop)
function needsCrop(ow: number, oh: number, tw: number, th: number): boolean {
  if (oh === 0 || th === 0) return false;
  const orig = ow / oh;
  const target = tw / th;
  return Math.abs(orig - target) / orig > 0.02;
}

// 중앙 크롭(cover) 후 정확한 크기 (processor._crop_to_fit)
function cropToFit(bitmap: ImageBitmap, ow: number, oh: number, tw: number, th: number): HTMLCanvasElement {
  const scale = Math.max(tw / ow, th / oh);
  const tempW = Math.max(tw, Math.round(ow * scale));
  const tempH = Math.max(th, Math.round(oh * scale));
  const mid = scale > 1 ? drawUpscaleProgressive(bitmap, ow, oh, tempW, tempH) : drawDownscale(bitmap, ow, oh, tempW, tempH);
  const left = Math.floor((tempW - tw) / 2);
  const top = Math.floor((tempH - th) / 2);
  const out = canvasOf(tw, th);
  out.ctx.drawImage(mid, left, top, tw, th, 0, 0, tw, th);
  return out.cv;
}

// JPG 배경(투명 → 흰색) 처리
function flattenWhite(cv: HTMLCanvasElement): HTMLCanvasElement {
  const out = canvasOf(cv.width, cv.height);
  out.ctx.fillStyle = "#ffffff";
  out.ctx.fillRect(0, 0, cv.width, cv.height);
  out.ctx.drawImage(cv, 0, 0);
  return out.cv;
}

function canvasToBlob(cv: HTMLCanvasElement, fmt: OutFormat, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    cv.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("이미지 변환 실패"))),
      MIME[fmt],
      fmt === "PNG" ? undefined : Math.min(1, Math.max(0.01, quality / 100))
    );
  });
}

// 단일 이미지 처리. aiUpscale: (bitmap,tw,th)=>canvas — AI 경로(선택)
export async function processImage(
  src: SourceImage,
  o: ResizeOptions,
  aiUpscale?: (bitmap: ImageBitmap, tw: number, th: number) => Promise<HTMLCanvasElement>
): Promise<ResizeResult> {
  const { width: ow, height: oh, bitmap } = src;
  const { tw, th } = calcTargetSize(ow, oh, o);
  const isUpscaling = tw > ow || th > oh;

  let cv: HTMLCanvasElement;
  if (needsCrop(ow, oh, tw, th)) {
    cv = cropToFit(bitmap, ow, oh, tw, th);
  } else if (isUpscaling && o.upscaleMethod === "ai" && aiUpscale) {
    cv = await aiUpscale(bitmap, tw, th);
  } else if (isUpscaling) {
    cv = drawUpscaleProgressive(bitmap, ow, oh, tw, th);
  } else {
    cv = drawDownscale(bitmap, ow, oh, tw, th);
  }

  if (o.outFmt === "JPG") cv = flattenWhite(cv);

  const blob = await canvasToBlob(cv, o.outFmt, o.quality);
  const base = src.name.replace(/\.[^.]+$/, "");
  return {
    name: base + EXT[o.outFmt],
    blob,
    width: cv.width,
    height: cv.height,
    bytes: blob.size,
    url: URL.createObjectURL(blob),
  };
}

// <img> 태그로 디코딩 — 확장자와 무관하게 실제 바이트로 형식 판별(원시 Blob 디코딩보다 관대).
// 구글 이미지 등에서 받은 '.png인데 실제로는 webp/avif'인 파일도 열린다.
function decodeToImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지 디코딩 실패(지원하지 않는 형식일 수 있음)"));
    img.src = url;
  });
}

// 확장자와 무관하게 실제 내용이 이미지가 아닌 경우 친절한 메시지
async function contentHint(file: File): Promise<string | null> {
  try {
    const head = (await file.slice(0, 256).text()).trim().toLowerCase();
    if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<head"))
      return "이미지가 아니라 웹페이지(HTML) 파일입니다. 실제 이미지를 저장해 주세요.";
    if (head.startsWith("{") || head.startsWith("["))
      return "이미지가 아니라 텍스트(JSON) 파일입니다.";
  } catch {
    /* 무시 */
  }
  return null;
}

// 파일 → SourceImage (견고한 디코딩). 성공 시 previewUrl은 살려두고(대기 중 미리보기용),
// 실패 시에만 해제한다. (해제 책임은 호출측: clear 시 revoke)
export async function loadSource(file: File): Promise<SourceImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await decodeToImage(url);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error("이미지 크기를 읽을 수 없습니다.");
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(img);
    } catch {
      // 폴백: 디코드된 <img>를 캔버스에 그려 비트맵 생성(항상 성공)
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      cv.getContext("2d")!.drawImage(img, 0, 0);
      bitmap = await createImageBitmap(cv);
    }
    return { name: file.name, bitmap, width: bitmap.width, height: bitmap.height, bytes: file.size, previewUrl: url };
  } catch (e) {
    URL.revokeObjectURL(url); // 실패 시 즉시 해제
    const hint = await contentHint(file);
    throw new Error(hint || (e instanceof Error ? e.message : String(e)));
  }
}

export function fmtBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
