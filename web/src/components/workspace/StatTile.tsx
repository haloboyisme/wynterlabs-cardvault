import type { ReactNode } from "react";

type StatTileProps = {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  progress?: number;
  className?: string;
};

export function StatTile({ label, value, detail, progress, className }: StatTileProps) {
  const classes = ["workspace-stat", className].filter(Boolean).join(" ");
  const hasProgress = typeof progress === "number";

  return (
    <article className={classes}>
      <p className="workspace-stat-label">{label}</p>
      <strong className="workspace-stat-value">{value}</strong>
      {detail ? <p className="workspace-stat-detail">{detail}</p> : null}
      {hasProgress ? (
        <progress className="workspace-stat-progress" value={progress} max={100} aria-label="Progress" />
      ) : null}
    </article>
  );
}
