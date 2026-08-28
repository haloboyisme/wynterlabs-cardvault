import type { ReactNode } from "react";

type FeedbackTone = "error" | "success" | "warning" | "info";

type FeedbackBannerProps = {
  children: ReactNode;
  tone: FeedbackTone;
  className?: string;
};

export function FeedbackBanner({ children, tone, className }: FeedbackBannerProps) {
  const classes = ["workspace-feedback", `workspace-feedback-${tone}`, className]
    .filter(Boolean)
    .join(" ");
  const liveProps = tone === "error"
    ? { role: "alert" as const }
    : { role: "status" as const, "aria-live": "polite" as const };

  return (
    <div className={classes} {...liveProps}>
      {children}
    </div>
  );
}
