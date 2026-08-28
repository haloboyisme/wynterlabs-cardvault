import type { ReactNode } from "react";

type EmptyStateProps = {
  title: ReactNode;
  description: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, children, className }: EmptyStateProps) {
  const classes = ["workspace-empty", className].filter(Boolean).join(" ");

  return (
    <section className={classes}>
      <h2>{title}</h2>
      <p>{description}</p>
      {children ? <div className="workspace-empty-actions">{children}</div> : null}
    </section>
  );
}
