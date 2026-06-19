import { won, growth } from "../lib/format";

interface MetricCardProps {
  label: string;
  amount: number;
  // 비교 대상(작년 동기간). 없으면 성장률 미표시.
  compareTo?: number;
  compareLabel?: string; // 예: "작년 동기간"
  hint?: string; // 보조 설명
}

export function MetricCard({
  label,
  amount,
  compareTo,
  compareLabel = "작년 동기간",
  hint,
}: MetricCardProps) {
  const g = compareTo != null ? growth(amount, compareTo) : null;

  return (
    <section className="metric">
      <div className="metric__label">{label}</div>
      <div className="metric__amount">{won(amount)}</div>

      {g && (
        <div className="metric__compare">
          <span className={`metric__badge metric__badge--${g.tone}`}>
            {g.tone === "up" ? "▲" : g.tone === "down" ? "▼" : ""} {g.text}
          </span>
          <span className="metric__compare-text">
            {compareLabel} {won(compareTo!)}
          </span>
        </div>
      )}

      {hint && <div className="metric__hint">{hint}</div>}
    </section>
  );
}
