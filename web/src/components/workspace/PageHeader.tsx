import type { ReactNode } from "react";

type PageHeaderProps = {
  children: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  children,
  eyebrow,
  description,
  status,
  actions,
  className,
}: PageHeaderProps) {
  const classes = ["workspace-page-header", className].filter(Boolean).join(" ");

  return (
    <header className={classes}>
      <div className="workspace-page-header-main">
        {eyebrow ? <p className="workspace-page-header-eyebrow">{eyebrow}</p> : null}
        <h1>{children}</h1>
        {description ? <p className="workspace-page-header-description">{description}</p> : null}
      </div>
      {status ? <div className="workspace-page-header-status">{status}</div> : null}
      {actions ? <div className="workspace-page-header-actions">{actions}</div> : null}
    </header>
  );
}
