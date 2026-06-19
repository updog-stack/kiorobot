export interface NavItem {
  key: string;
  label: string;
  icon: string;
}

interface SidebarProps {
  items: NavItem[];
  active: string;
  onSelect: (key: string) => void;
}

export function Sidebar({ items, active, onSelect }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        다인아이앤씨
        <span>노션 통합 대시보드</span>
      </div>

      <nav className="nav">
        {items.map((item) => (
          <button
            key={item.key}
            className={`nav__item${item.key === active ? " is-active" : ""}`}
            onClick={() => onSelect(item.key)}
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="sidebar__footer">
        데이터 원본: Notion
        <br />
        Single Source of Truth
      </div>
    </aside>
  );
}
