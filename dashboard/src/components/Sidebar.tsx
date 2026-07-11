export interface NavItem {
  key: string;
  label: string;
  icon: string;
}

interface SidebarProps {
  items: NavItem[];
  active: string;
  onSelect: (key: string) => void;
  open?: boolean; // 모바일 드로어 열림 여부
  onClose?: () => void;
}

export function Sidebar({ items, active, onSelect, open, onClose }: SidebarProps) {
  return (
    <>
      {open && <div className="sidebar__backdrop" onClick={onClose} />}
      <aside className={`sidebar${open ? " is-open" : ""}`}>
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
    </>
  );
}
