import { useEffect, useState } from "react";
import { fetchTr, type TrData } from "../lib/tr";
import { fetchSalesMonthly, type SalesMonthly } from "../lib/sales";
import { TotalSalesChart } from "./Overview";
import { TrTrend, CmsSection } from "./TrMetrics";

// 매출현황 — 흩어져 있던 매출 데이터를 한 메뉴로 통합(중복 제거).
//   · 총매출(장비·라이선스·기타, 노션)  · VAN 결제금액(코밴+다우, 가맹점 거래대금 참고)  · CMS 매출(효성CMS 수납액)
//   기존 컴포넌트를 그대로 재사용 → 전체현황·거래현황과 코드/데이터 중복 없음.
export function SalesStatus() {
  const [sales, setSales] = useState<SalesMonthly | null>(null);
  const [tr, setTr] = useState<TrData | null>(null);
  useEffect(() => {
    fetchSalesMonthly().then(setSales).catch(() => {});
    fetchTr().then(setTr).catch(() => {});
  }, []);

  return (
    <div className="sales" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="ov__banner">
        회사 매출 통합 — 총매출(제품)·CMS 수납·VAN 결제금액을 한 곳에서
        <span>· 총매출·CMS는 다인 매출, VAN 결제금액은 가맹점 거래대금(참고)</span>
      </div>

      {/* 1) 총매출 (장비·라이선스·기타) */}
      <div className="ov__sec-h" style={{ marginTop: 8 }}>
        <h2>총매출</h2>
        <span>장비·라이선스·기타 (노션 · 구분 선택)</span>
      </div>
      <TotalSalesChart curByCat={sales?.curByCat ?? null} lastMonth={sales?.lastMonth ?? 0} />

      {/* 2) VAN 결제금액 (금액만 — 건수는 거래현황 전용) */}
      <TrTrend series={tr?.series} years={tr?.years} amountOnly />

      {/* 3) CMS 매출 (효성CMS 수납액) */}
      <CmsSection />
    </div>
  );
}
