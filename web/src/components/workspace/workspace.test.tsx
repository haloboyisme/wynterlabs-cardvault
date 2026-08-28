import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DisclosurePanel } from "./DisclosurePanel";
import { EmptyState } from "./EmptyState";
import { FeedbackBanner } from "./FeedbackBanner";
import { PageHeader } from "./PageHeader";
import { StatTile } from "./StatTile";

describe("workspace presentation components", () => {
  it("renders an error feedback banner as an alert", () => {
    render(<FeedbackBanner tone="error">Could not save.</FeedbackBanner>);

    expect(screen.getByRole("alert")).toHaveTextContent("Could not save.");
  });

  it("renders success feedback with polite status semantics", () => {
    render(<FeedbackBanner tone="success">Saved.</FeedbackBanner>);

    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it.each(["warning", "info"] as const)("uses a polite status for %s feedback", (tone) => {
    render(<FeedbackBanner tone={tone}>Notice.</FeedbackBanner>);

    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("renders a native disclosure with its requested initial state", () => {
    render(<DisclosurePanel title="Advanced filters" defaultOpen={false}>Details</DisclosurePanel>);

    expect(screen.getByText("Advanced filters").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Details")).toBeInTheDocument();
  });

  it("opens a disclosure when requested", () => {
    render(<DisclosurePanel title="Advanced filters" defaultOpen>Details</DisclosurePanel>);

    expect(screen.getByText("Advanced filters").closest("details")).toHaveAttribute("open");
  });

  it("renders stat values and supporting detail", () => {
    render(<StatTile label="Sets" value="18" detail="Across the collection" />);

    expect(screen.getByText("18")).toBeVisible();
    expect(screen.getByText("Across the collection")).toBeInTheDocument();
  });

  it("renders one page heading, optional status, and actions", () => {
    render(
      <PageHeader status="Synced" actions={<button type="button">Add set</button>}>
        Collection
      </PageHeader>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Collection" })).toBeInTheDocument();
    expect(screen.getByText("Synced")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add set" })).toBeInTheDocument();
  });

  it("renders an empty-state action when supplied", () => {
    render(
      <EmptyState title="No cards yet" description="Add your first card to get started.">
        <button type="button">Add card</button>
      </EmptyState>,
    );

    expect(screen.getByRole("heading", { name: "No cards yet" })).toBeInTheDocument();
    expect(screen.getByText("Add your first card to get started.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add card" })).toBeInTheDocument();
  });
});
