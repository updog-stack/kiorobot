import type { ReactNode } from "react";

interface CardProps {
  title: string;
  description?: string;
  wide?: boolean;
  children?: ReactNode;
}

export function Card({ title, description, wide, children }: CardProps) {
  return (
    <section className={`card${wide ? " card--wide" : ""}`}>
      <h2 className="card__title">{title}</h2>
      {description && <p className="card__desc">{description}</p>}
      {children ?? (
        <div className="card__placeholder">데이터 연동 예정 (Notion API → BFF)</div>
      )}
    </section>
  );
}
