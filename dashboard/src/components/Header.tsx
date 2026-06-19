export type Role = "ceo" | "lead" | "staff";

export const ROLES: { key: Role; label: string }[] = [
  { key: "ceo", label: "대표" },
  { key: "lead", label: "팀장" },
  { key: "staff", label: "직원" },
];

interface HeaderProps {
  title: string;
  subtitle?: string;
  role: Role;
  onRoleChange: (role: Role) => void;
}

export function Header({ title, subtitle, role, onRoleChange }: HeaderProps) {
  return (
    <header className="header">
      <div>
        <h1 className="header__title">{title}</h1>
        {subtitle && <p className="header__sub">{subtitle}</p>}
      </div>

      <div className="role-switch" role="group" aria-label="역할 선택">
        {ROLES.map((r) => (
          <button
            key={r.key}
            className={r.key === role ? "is-active" : ""}
            onClick={() => onRoleChange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>
    </header>
  );
}
