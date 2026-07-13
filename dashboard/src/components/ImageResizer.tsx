import { useRef, useState, type CSSProperties } from "react";
import {
  loadSource,
  processImage,
  calcTargetSize,
  fmtBytes,
  READ_ACCEPT,
  type ResizeMode,
  type OutFormat,
  type ResizeOptions,
  type SourceImage,
  type ResizeResult,
} from "../lib/imageResize";

interface Row {
  src: SourceImage;
  result?: ResizeResult;
  status: "대기" | "처리 중" | "완료" | "오류";
  error?: string;
  aiProgress?: number;
}

const CHECK_ROW: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  fontSize: 14,
  cursor: "pointer",
  lineHeight: 1.5,
};
const FIELDS_WRAP: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 14 };

const MODES: { id: ResizeMode; label: string }[] = [
  { id: "pixel", label: "픽셀(W×H)" },
  { id: "percent", label: "퍼센트(%)" },
  { id: "width", label: "가로 기준" },
  { id: "height", label: "세로 기준" },
];
const FORMATS: OutFormat[] = ["JPG", "PNG", "WEBP"];

export function ImageResizer() {
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<ResizeMode>("percent");
  const [valueW, setValueW] = useState(1920);
  const [valueH, setValueH] = useState(1080);
  const [valuePct, setValuePct] = useState(50);
  const [keepRatio, setKeepRatio] = useState(true);
  const [outFmt, setOutFmt] = useState<OutFormat>("JPG");
  const [quality, setQuality] = useState(90);
  const [useAI, setUseAI] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const opts = (): ResizeOptions => ({
    mode,
    valueW,
    valueH,
    valuePct,
    keepRatio,
    outFmt,
    quality,
    upscaleMethod: useAI ? "ai" : "algorithm",
  });

  async function onPick(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const loaded: Row[] = [];
    for (const f of Array.from(files)) {
      try {
        loaded.push({ src: await loadSource(f), status: "대기" });
      } catch (e) {
        loaded.push({
          src: { name: f.name, bitmap: null as unknown as ImageBitmap, width: 0, height: 0, bytes: f.size, previewUrl: "" },
          status: "오류",
          error: String(e instanceof Error ? e.message : e).slice(0, 80),
        });
      }
    }
    setRows((prev) => [...prev, ...loaded]);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function runAll() {
    if (rows.length === 0) {
      setError("이미지를 먼저 추가해 주세요.");
      return;
    }
    setRunning(true);
    setError(null);

    let aiUpscale: ((b: ImageBitmap, tw: number, th: number, cb?: (p: number) => void) => Promise<HTMLCanvasElement>) | undefined;
    if (useAI) {
      try {
        const mod = await import("../lib/aiUpscale");
        aiUpscale = mod.upscaleAI;
      } catch {
        setError("AI 모듈 로드 실패 — 알고리즘 방식으로 처리합니다.");
      }
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.src.bitmap) continue;
      setRows((prev) => prev.map((r, j) => (j === i ? { ...r, status: "처리 중", aiProgress: undefined } : r)));
      try {
        const o = opts();
        const ai =
          o.upscaleMethod === "ai" && aiUpscale
            ? (b: ImageBitmap, tw: number, th: number) =>
                aiUpscale!(b, tw, th, (p) =>
                  setRows((prev) => prev.map((r, j) => (j === i ? { ...r, aiProgress: p } : r)))
                )
            : undefined;
        const result = await processImage(row.src, o, ai);
        setRows((prev) => prev.map((r, j) => (j === i ? { ...r, result, status: "완료", aiProgress: undefined } : r)));
      } catch (e) {
        setRows((prev) =>
          prev.map((r, j) =>
            j === i ? { ...r, status: "오류", error: String(e instanceof Error ? e.message : e) } : r
          )
        );
      }
    }
    setRunning(false);
  }

  function download(row: Row) {
    if (!row.result) return;
    const a = document.createElement("a");
    a.href = row.result.url;
    a.download = row.result.name;
    a.click();
  }

  function downloadAll() {
    rows.filter((r) => r.result).forEach((r, i) => setTimeout(() => download(r), i * 150));
  }

  function clearAll() {
    rows.forEach((r) => {
      if (r.result) URL.revokeObjectURL(r.result.url);
      if (r.src.previewUrl) URL.revokeObjectURL(r.src.previewUrl);
    });
    setRows([]);
    setError(null);
  }

  const doneCount = rows.filter((r) => r.status === "완료").length;

  return (
    <div className="blog">
      <section className="card blog-form">
        <h2 className="card__title">🖼️ 이미지 리사이저</h2>
        <p className="card__desc">
          사진을 올려 <b>크기 조정·크롭·포맷 변환</b>을 한 번에 처리합니다. 모두 <b>브라우저에서 처리</b>되어
          사진이 서버로 올라가지 않습니다. 여러 장 <b>일괄 처리</b> 가능.
        </p>

        <div
          className="blog-field"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onPick(e.dataTransfer.files);
          }}
        >
          <span>이미지 추가 (드래그&드롭 또는 선택, 여러 장)</span>
          <input ref={inputRef} type="file" accept={READ_ACCEPT} multiple onChange={(e) => onPick(e.target.files)} />
        </div>

        <div style={FIELDS_WRAP}>
          <label className="blog-field" style={{ flex: "1 1 200px" }}>
            <span>크기 조정 방식</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as ResizeMode)}>
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>

          {mode === "percent" && (
            <label className="blog-field" style={{ flex: "1 1 150px" }}>
              <span>배율 (%)</span>
              <input type="number" min={1} max={800} value={valuePct} onChange={(e) => setValuePct(Number(e.target.value) || 0)} />
            </label>
          )}
          {mode === "pixel" && (
            <>
              <label className="blog-field" style={{ flex: "1 1 130px" }}>
                <span>가로 (px)</span>
                <input type="number" min={1} value={valueW} onChange={(e) => setValueW(Number(e.target.value) || 0)} />
              </label>
              <label className="blog-field" style={{ flex: "1 1 130px" }}>
                <span>세로 (px)</span>
                <input type="number" min={1} value={valueH} onChange={(e) => setValueH(Number(e.target.value) || 0)} />
              </label>
            </>
          )}
          {mode === "width" && (
            <label className="blog-field" style={{ flex: "1 1 150px" }}>
              <span>가로 (px)</span>
              <input type="number" min={1} value={valueW} onChange={(e) => setValueW(Number(e.target.value) || 0)} />
            </label>
          )}
          {mode === "height" && (
            <label className="blog-field" style={{ flex: "1 1 150px" }}>
              <span>세로 (px)</span>
              <input type="number" min={1} value={valueH} onChange={(e) => setValueH(Number(e.target.value) || 0)} />
            </label>
          )}
        </div>

        <div style={FIELDS_WRAP}>
          <label className="blog-field" style={{ flex: "1 1 150px" }}>
            <span>출력 형식</span>
            <select value={outFmt} onChange={(e) => setOutFmt(e.target.value as OutFormat)}>
              {FORMATS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>
          {outFmt !== "PNG" && (
            <label className="blog-field" style={{ flex: "2 1 240px" }}>
              <span>품질 ({quality})</span>
              <input type="range" min={10} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} style={{ padding: 0 }} />
            </label>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 2 }}>
          <label style={{ ...CHECK_ROW, alignItems: "center" }}>
            <input type="checkbox" checked={keepRatio} onChange={(e) => setKeepRatio(e.target.checked)} style={{ width: 16, height: 16 }} />
            <span>비율 유지</span>
          </label>
          <label style={CHECK_ROW}>
            <input type="checkbox" checked={useAI} onChange={(e) => setUseAI(e.target.checked)} style={{ width: 16, height: 16, marginTop: 3 }} />
            <span>
              AI 고품질 업스케일{" "}
              <span className="muted" style={{ fontWeight: 400 }}>(확대 시, 브라우저 AI — 첫 사용 시 모델 로딩·다소 느림)</span>
              <br />
              <small className="muted" style={{ fontSize: 12 }}>
                끄면 알고리즘(단계적 확대+선명화)으로 빠르게 처리합니다. 축소·크롭에는 영향 없습니다.
              </small>
            </span>
          </label>
        </div>

        {error && <div className="state state--error">{error}</div>}

        <div className="blog-actions">
          <button className="blog-run" onClick={runAll} disabled={running || rows.length === 0}>
            {running ? "처리 중…" : `변환 시작 (${rows.length})`}
          </button>
          {doneCount > 0 && (
            <button className="blog-run blog-copy-all" onClick={downloadAll} disabled={running}>
              전체 다운로드 ({doneCount})
            </button>
          )}
          <button className="blog-reset" onClick={clearAll} disabled={running}>초기화</button>
        </div>
      </section>

      {rows.length > 0 && (
        <section className="card blog-result">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
            {rows.map((r, i) => (
              <ImgCard key={i} row={r} onDownload={() => download(r)} onTarget={() => targetLabel(r, opts())} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function targetLabel(row: Row, o: ResizeOptions): string {
  if (!row.src.width) return "–";
  const { tw, th } = calcTargetSize(row.src.width, row.src.height, o);
  return `${tw}×${th}`;
}

function ImgCard({ row, onDownload, onTarget }: { row: Row; onDownload: () => void; onTarget: () => string }) {
  const src = row.src;
  const preview = row.result?.url ?? (src.previewUrl || undefined);
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--surface, #fff)" }}>
      <div style={{ aspectRatio: "4/3", background: "#0001", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {preview ? (
          <img src={preview} alt={src.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>미리보기 없음</span>
        )}
      </div>
      <div style={{ padding: 10, fontSize: 12, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={src.name}>
          {src.name}
        </div>
        <div className="muted">
          {src.width}×{src.height} · {fmtBytes(src.bytes)}
          {row.result && (
            <>
              {" → "}
              <b style={{ color: "var(--text)" }}>{row.result.width}×{row.result.height}</b> · {fmtBytes(row.result.bytes)}
            </>
          )}
          {!row.result && src.width > 0 && <> · 목표 {onTarget()}</>}
        </div>
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <StatusBadge row={row} />
          {row.result && (
            <button className="blog-copy" onClick={onDownload}>다운로드</button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ row }: { row: Row }) {
  const color =
    row.status === "완료" ? "#047857" : row.status === "오류" ? "#b91c1c" : row.status === "처리 중" ? "#1d4ed8" : "#64748b";
  const label =
    row.status === "처리 중" && row.aiProgress != null
      ? `AI ${Math.round(row.aiProgress * 100)}%`
      : row.status === "오류"
      ? row.error || "오류"
      : row.status;
  return <span style={{ fontSize: 11, fontWeight: 700, color }}>{label}</span>;
}
