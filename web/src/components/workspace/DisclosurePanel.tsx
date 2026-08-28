import type { ReactNode } from "react";

type DisclosurePanelProps = {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

export function DisclosurePanel({ title, children, defaultOpen = false, className }: DisclosurePanelProps) {
  const classes = ["workspace-disclosure", className].filter(Boolean).join(" ");

  return (
    <details className={classes} open={defaultOpen}>
      <summary>{title}</summary>
      <div className="workspace-disclosure-content">{children}</div>
    </details>
  );
}
