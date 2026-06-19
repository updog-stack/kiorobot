import { useEffect, useState } from "react";
import { fetchSales } from "../lib/sales";
import { computeMetrics, type SalesMetrics as Metrics } from "../lib/metrics";
import { won } from "../lib/format";
import { MetricCard } from "./MetricCard";

export function SalesMetrics() {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSales()
      .then((records) => {
        if (alive) setData(computeMetrics(records));
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <div className="state state--error">불러오기 실패: {error}</div>;
  if (!data) return <div className="state">매출 데이터를 불러오는 중…</div>;

  return (
    <div className="sales">
      <div className="sales__kpis">
        <MetricCard
          label="금일 매출"
          amount={data.today}
          hint={data.todayLabel}
        />
        <MetricCard
          label="월간 매출"
          amount={data.monthThis}
          compareTo={data.monthLast}
          hint={`${data.currentYear}년 ${new Date().getMonth() + 1}월 (오늘까지)`}
        />
        <MetricCard
          label="월 평균 매출"
          amount={data.avgThis}
          compareTo={data.avgLast}
          hint={`올해 누적 ÷ ${data.monthsElapsed}개월`}
        />
        <MetricCard
          label="년간 매출"
          amount={data.yearThis}
          compareTo={data.yearLast}
          hint={`${data.currentYear}년 누적(YTD)`}
        />
      </div>

      <MonthlyChart data={data} />
    </div>
  );
}

function MonthlyChart({ data }: { data: Metrics }) {
  const max = Math.max(
    1,
    ...data.monthly.flatMap((p) => [p.thisYear, p.lastYear])
  );

  return (
    <section className="card card--wide">
      <h2 className="card__title">월별 매출 추이 — 올해 vs 작년</h2>
      <div className="chart">
        {data.monthly.map((p, i) => {
          const isCurrent = i === data.monthly.length - 1;
          return (
            <div className="chart__col" key={p.month}>
              <div className="chart__bars" title={`${p.month}월`}>
                <div
                  className="chart__bar chart__bar--prev"
                  style={{ height: `${(p.lastYear / max) * 100}%` }}
                  title={`작년 ${p.month}월: ${won(p.lastYear)}`}
                />
                <div
                  className="chart__bar chart__bar--cur"
                  style={{ height: `${(p.thisYear / max) * 100}%` }}
                  title={`올해 ${p.month}월: ${won(p.thisYear)}${
                    isCurrent ? " (진행 중)" : ""
                  }`}
                />
              </div>
              <div className="chart__xlabel">
                {p.month}월{isCurrent ? "*" : ""}
              </div>
            </div>
          );
        })}
      </div>
      <div className="chart__legend">
        <span>
          <i className="dot dot--cur" /> {data.currentYear}년(올해)
        </span>
        <span>
          <i className="dot dot--prev" /> {data.lastYear}년(작년)
        </span>
        <span className="chart__note">* 현재월은 진행 중(오늘까지)</span>
      </div>
    </section>
  );
}
