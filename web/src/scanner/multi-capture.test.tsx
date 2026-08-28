import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CardScanner } from "../components/CardScanner";
import type { CameraConsentStore } from "./camera-consent";

const consentStore: CameraConsentStore = {
  read: () => "allow",
  write: vi.fn(),
  clear: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("continuous multi-card capture", () => {
  it("counts down from five before automatically capturing a stable card", async () => {
    const user = userEvent.setup();
    const track = { stop: vi.fn(), getSettings: () => ({}) };
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    const onResult = vi.fn();
    const canvas = document.createElement("canvas");
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<CardScanner
      continuous
      sampleIntervalMs={10}
      countdownStepMs={80}
      sampleFingerprint={vi.fn(() => [10, 20, 30])}
      onResult={onResult}
      consentStore={consentStore}
      startCamera={vi.fn(async () => stream)}
      listCameras={vi.fn(async () => [])}
      captureFrame={vi.fn(() => canvas)}
      createPreview={vi.fn(async () => "blob:auto-card")}
      createUpload={vi.fn(async () => new Blob(["card"]))}
      createWorker={vi.fn(async () => ({
        recognize: vi.fn(async () => ({
          name: "Black Lotus",
          titleCandidates: ["Black Lotus"],
          rawText: "Black Lotus",
        })),
        terminate: vi.fn(async () => undefined),
      }))}
    />);
    await user.click(screen.getByRole("button", { name: "Start camera" }));
    const countdown = await screen.findByRole("status", { name: "Automatic capture countdown" });
    expect(countdown).toHaveTextContent("5");
    expect(onResult).not.toHaveBeenCalled();
    await waitFor(() => expect(countdown).toHaveTextContent("4"));
    await waitFor(() => expect(countdown).toHaveTextContent("3"));
    await waitFor(() => expect(countdown).toHaveTextContent("2"));
    await waitFor(() => expect(countdown).toHaveTextContent("1"));
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Card captured. Remove it or show the next card.")).toBeVisible();
  });

  it("keeps the stream open, transfers each preview, and stops only on request", async () => {
    const user = userEvent.setup();
    const stop = vi.fn();
    const track = { stop, getSettings: () => ({}) };
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    const onResult = vi.fn();
    const revokePreview = vi.fn();
    const canvas = document.createElement("canvas");
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();

    render(<CardScanner
      continuous
      onResult={onResult}
      consentStore={consentStore}
      startCamera={vi.fn(async () => stream)}
      listCameras={vi.fn(async () => [])}
      captureFrame={vi.fn(() => canvas)}
      sampleFingerprint={vi.fn(() => [10, 20, 30])}
      createPreview={vi.fn(async () => "blob:session-card")}
      createUpload={vi.fn(async () => new Blob(["card"]))}
      createWorker={vi.fn(async () => ({
        recognize: vi.fn(async () => ({
          name: "Black Lotus",
          titleCandidates: ["Black Lotus"],
          rawText: "Black Lotus",
        })),
        terminate: vi.fn(async () => undefined),
      }))}
      revokePreview={revokePreview}
    />);

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    await user.click(await screen.findByRole("button", { name: "Capture now" }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.objectContaining({
      previewUrl: "blob:session-card",
      imageBlob: expect.any(Blob),
    })));
    expect(screen.getByLabelText("Card camera preview")).toBeVisible();
    expect(stop).not.toHaveBeenCalled();
    expect(revokePreview).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Stop scanning" }));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("cancels the countdown when the card moves", async () => {
    const user = userEvent.setup();
    const track = { stop: vi.fn(), getSettings: () => ({}) };
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    const onResult = vi.fn();
    const canvas = document.createElement("canvas");
    let samples = 0;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<CardScanner
      continuous
      sampleIntervalMs={10}
      countdownStepMs={80}
      sampleFingerprint={vi.fn(() => {
        samples += 1;
        if (samples <= 3) return [10, 20, 30];
        return samples % 2 ? [100, 100, 100] : [200, 200, 200];
      })}
      onResult={onResult}
      consentStore={consentStore}
      startCamera={vi.fn(async () => stream)}
      listCameras={vi.fn(async () => [])}
      captureFrame={vi.fn(() => canvas)}
      createPreview={vi.fn(async () => "blob:moved-card")}
      createUpload={vi.fn(async () => new Blob(["card"]))}
      createWorker={vi.fn(async () => ({
        recognize: vi.fn(async () => ({
          name: "Black Lotus",
          titleCandidates: ["Black Lotus"],
          rawText: "Black Lotus",
        })),
        terminate: vi.fn(async () => undefined),
      }))}
    />);

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    expect(await screen.findByRole("status", { name: "Automatic capture countdown" }))
      .toHaveTextContent("5");
    expect(await screen.findByText(/card moved.*restart the countdown/i)).toBeVisible();
    expect(screen.queryByRole("status", { name: "Automatic capture countdown" }))
      .not.toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();
  });

  it("blocks all further captures at the 250-card session limit", async () => {
    const user = userEvent.setup();
    const stream = {
      getTracks: () => [],
      getVideoTracks: () => [],
    } as unknown as MediaStream;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<CardScanner
      continuous
      captureCount={250}
      maximumCaptures={250}
      onResult={vi.fn()}
      consentStore={consentStore}
      startCamera={vi.fn(async () => stream)}
      listCameras={vi.fn(async () => [])}
    />);
    await user.click(screen.getByRole("button", { name: "Start camera" }));
    expect(await screen.findByRole("button", { name: "Capture now" })).toBeDisabled();
    expect(screen.getByText("Session limit reached (250 cards)."))
      .toHaveAttribute("role", "status");
  });
});
