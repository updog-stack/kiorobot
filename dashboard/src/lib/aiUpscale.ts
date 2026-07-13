// AI 업스케일 (선택) — UpscalerJS(TensorFlow.js) 기반 브라우저 초해상.
// ESRGAN-slim x4 모델을 브라우저에서 실행한다. (기존 파이썬의 ESPCN/EDSR 대체)
// 라이브러리·모델이 무거우므로 '사용 시점에만' 동적 import 한다.

type UpscalerInstance = { upscale: (input: HTMLCanvasElement, opts: Record<string, unknown>) => Promise<string> };

let upscalerPromise: Promise<UpscalerInstance> | null = null;

async function getUpscaler(): Promise<UpscalerInstance> {
  if (!upscalerPromise) {
    upscalerPromise = (async () => {
      const [{ default: Upscaler }, model] = await Promise.all([
        import("upscaler"),
        import("@upscalerjs/esrgan-slim/4x"),
      ]);
      // @ts-expect-error UpscalerJS 생성자/모델 타입은 런타임에 호환됨
      return new Upscaler({ model: (model as { default: unknown }).default }) as UpscalerInstance;
    })();
  }
  return upscalerPromise;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("AI 결과 이미지 로드 실패"));
    img.src = src;
  });
}

// 미리 모델을 내려받아 준비(선택). 실패해도 throw 안 함(사용 시 재시도).
export async function warmUpAI(): Promise<boolean> {
  try {
    await getUpscaler();
    return true;
  } catch {
    upscalerPromise = null;
    return false;
  }
}

// bitmap을 AI로 4× 초해상 → 목표 크기(tw×th)로 정밀 조정한 canvas 반환.
export async function upscaleAI(
  bitmap: ImageBitmap,
  tw: number,
  th: number,
  onProgress?: (p: number) => void
): Promise<HTMLCanvasElement> {
  const up = await getUpscaler();

  // ImageBitmap → canvas (UpscalerJS 입력)
  const src = document.createElement("canvas");
  src.width = bitmap.width;
  src.height = bitmap.height;
  src.getContext("2d")!.drawImage(bitmap, 0, 0);

  const base64 = await up.upscale(src, {
    output: "base64",
    patchSize: 64, // 타일 처리(큰 이미지·GPU 한계 대응)
    padding: 4,
    progress: (p: number) => onProgress?.(p),
  });

  const img = await loadImage(base64);

  // AI 4× 결과 → 목표 크기로 조정
  const out = document.createElement("canvas");
  out.width = tw;
  out.height = th;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, tw, th);
  return out;
}
