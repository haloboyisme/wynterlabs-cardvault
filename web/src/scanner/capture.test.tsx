import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CardScanner } from "../components/CardScanner";
import type { CameraConsent, CameraConsentStore } from "./camera-consent";
import type { CameraDeviceStore } from "./camera-device";
import {
  captureGuidedCardFrame,
  mapGuideToSource,
  prepareCardImage,
  preprocessOcrRegion,
  startCardCamera,
} from "./capture";

function consentStore(initial: CameraConsent = null): CameraConsentStore {
  let choice = initial;
  return {
    read: () => choice,
    write: (value) => {
      choice = value;
    },
    clear: () => {
      choice = null;
    },
  };
}

function deviceStore(initial: string | null = null): CameraDeviceStore {
  let selected = initial;
  return {
    read: () => selected,
    write: (deviceId) => {
      selected = deviceId;
    },
    clear: () => {
      selected = null;
    },
  };
}

function cameraDevice(deviceId: string, label: string): MediaDeviceInfo {
  return {
    deviceId,
    groupId: "camera-group",
    kind: "videoinput",
    label,
    toJSON: vi.fn(),
  } as MediaDeviceInfo;
}

function cameraStream(deviceId: string) {
  const stop = vi.fn();
  const track = { getSettings: () => ({ deviceId }), stop };
  return {
    stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream,
    stop,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.removeItem("wynterlabs.cards.camera-alignment.v2");
  localStorage.removeItem("wynterlabs.cards.capture-shortcut.v1");
});

describe("private one-card capture", () => {
  it("requests only an environment-facing camera and stops every track", async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    expect(await startCardCamera()).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });

    await startCardCamera("usb-id");
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: { deviceId: { exact: "usb-id" } },
    });
  });

  it("shows a labelled live camera stage after access succeeds", async () => {
    const user = userEvent.setup();
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();

    render(
      <CardScanner
        onResult={vi.fn()}
        consentStore={consentStore("allow")}
        startCamera={vi.fn(async () => stream)}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start camera" }));

    const stage = await screen.findByRole("region", { name: "Live camera" });
    const video = screen.getByLabelText("Card camera preview");
    expect(stage).toContainElement(video);
    expect(video).toHaveAttribute("autoplay");
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveProperty("muted", true);
    expect(screen.getByRole("button", { name: "Capture card" })).toBeVisible();
  });

  it("keeps supplied workspace controls and the camera picker above the live preview", async () => {
    const user = userEvent.setup();
    const active = cameraStream("rear-camera");
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();

    render(
      <CardScanner
        onResult={vi.fn()}
        consentStore={consentStore("allow")}
        startCamera={vi.fn(async () => active.stream)}
        listCameras={vi.fn(async () => [cameraDevice("rear-camera", "Rear camera")])}
        topControls={<fieldset><legend>Scanning mode</legend><span>Workspace preferences</span></fieldset>}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start camera" }));

    const controls = screen.getByRole("region", { name: "Scanner controls" });
    const stage = await screen.findByRole("region", { name: "Live camera" });
    expect(controls).toContainElement(screen.getByRole("group", { name: "Scanning mode" }));
    expect(controls).toHaveTextContent("Workspace preferences");
    expect(controls).toContainElement(screen.getByLabelText("Camera"));
    expect(stage).not.toContainElement(controls);
    expect(screen.queryByText(/automated scanner|hardware/i)).not.toBeInTheDocument();
  });

  it("attaches the camera stream after the video element mounts", async () => {
    const user = userEvent.setup();
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(globalThis, "queueMicrotask").mockImplementation((callback) => callback());

    render(
      <CardScanner
        onResult={vi.fn()}
        consentStore={consentStore("allow")}
        startCamera={vi.fn(async () => stream)}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start camera" }));

    const video = await screen.findByLabelText("Card camera preview");
    await waitFor(() => {
      expect(video).toHaveProperty("srcObject", stream);
      expect(play).toHaveBeenCalledTimes(1);
    });
  });

  it("shows every available camera in a labelled selector", async () => {
    const user = userEvent.setup();
    const rear = cameraStream("rear-id");
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();

    render(
      <CardScanner
        onResult={vi.fn()}
        consentStore={consentStore("allow")}
        deviceStore={deviceStore("rear-id")}
        startCamera={vi.fn(async () => rear.stream)}
        listCameras={vi.fn(async () => [
          cameraDevice("rear-id", "Back Camera"),
          cameraDevice("front-id", ""),
        ])}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start camera" }));

    const selector = await screen.findByRole("combobox", { name: "Camera" });
    expect(selector).toHaveValue("rear-id");
    expect(screen.getByRole("option", { name: "Back Camera" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Camera 2" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Change camera permission" })).toBeVisible();
  });

  it("switches to a selected camera, saves it, then stops the old stream", async () => {
    const user = userEvent.setup();
    const store = deviceStore("rear-id");
    const rear = cameraStream("rear-id");
    const front = cameraStream("front-id");
    const startCamera = vi.fn(async (deviceId?: string) =>
      deviceId === "front-id" ? front.stream : rear.stream,
    );
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();

    render(
      <CardScanner
        onResult={vi.fn()}
        consentStore={consentStore("allow")}
        deviceStore={store}
        startCamera={startCamera}
        listCameras={vi.fn(async () => [
          cameraDevice("rear-id", "Back Camera"),
          cameraDevice("front-id", "Front Camera"),
        ])}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    const selector = await screen.findByRole("combobox", { name: "Camera" });
    const video = screen.getByLabelText("Card camera preview");
    expect(video).toHaveProperty("srcObject", rear.stream);

    await user.selectOptions(selector, "front-id");

    await waitFor(() => expect(video).toHaveProperty("srcObject", front.stream));
    expect(startCamera).toHaveBeenLastCalledWith("front-id");
    expect(rear.stop).toHaveBeenCalledTimes(1);
    expect(front.stop).not.toHaveBeenCalled();
    expect(store.read()).toBe("front-id");
    expect(selector).toHaveValue("front-id");
  });

  it("keeps the working camera when a selected replacement fails", async () => {
    const user = userEvent.setup();
    const store = deviceStore("rear-id");
    const rear = cameraStream("rear-id");
    const startCamera = vi.fn(async (deviceId?: string) => {
      if (deviceId === "front-id") throw new DOMException("missing", "NotFoundError");
      return rear.stream;
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();

    render(
      <CardScanner
        onResult={vi.fn()}
        consentStore={consentStore("allow")}
        deviceStore={store}
        startCamera={startCamera}
        listCameras={vi.fn(async () => [
          cameraDevice("rear-id", "Back Camera"),
          cameraDevice("front-id", "Front Camera"),
        ])}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    const selector = await screen.findByRole("combobox", { name: "Camera" });
    const video = screen.getByLabelText("Card camera preview");
    await user.selectOptions(selector, "front-id");

    expect(await screen.findByRole("alert")).toHaveTextContent(/camera could not be changed/i);
    expect(video).toHaveProperty("srcObject", rear.stream);
    expect(rear.stop).not.toHaveBeenCalled();
    expect(store.read()).toBe("rear-id");
    expect(selector).toHaveValue("rear-id");
  });

  it("opens the remembered camera first", async () => {
    const user = userEvent.setup();
    const usb = cameraStream("usb-id");
    const startCamera = vi.fn(async () => usb.stream);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();

    render(
      <CardScanner
        onResult={vi.fn()}
        consentStore={consentStore("allow")}
        deviceStore={deviceStore("usb-id")}
        startCamera={startCamera}
        listCameras={vi.fn(async () => [cameraDevice("usb-id", "USB Camera")])}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start camera" }));

    await screen.findByRole("combobox", { name: "Camera" });
    expect(startCamera).toHaveBeenNthCalledWith(1, "usb-id");
  });

  it("clears a missing remembered camera and falls back once", async () => {
    const user = userEvent.setup();
    const store = deviceStore("missing-id");
    const clear = vi.spyOn(store, "clear");
    const rear = cameraStream("rear-id");
    const startCamera = vi.fn(async (deviceId?: string) => {
      if (deviceId === "missing-id") throw new DOMException("missing", "NotFoundError");
      return rear.stream;
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();

    render(
      <CardScanner
        onResult={vi.fn()}
        consentStore={consentStore("allow")}
        deviceStore={store}
        startCamera={startCamera}
        listCameras={vi.fn(async () => [cameraDevice("rear-id", "Back Camera")])}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start camera" }));

    expect(await screen.findByRole("combobox", { name: "Camera" })).toHaveValue("rear-id");
    expect(startCamera.mock.calls).toEqual([["missing-id"], [undefined]]);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(store.read()).toBe("rear-id");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refreshes camera options on device changes and removes the listener", async () => {
    const user = userEvent.setup();
    const rear = cameraStream("rear-id");
    let onDeviceChange: (() => void) | undefined;
    const addEventListener = vi.fn((_event: string, listener: EventListenerOrEventListenerObject) => {
      onDeviceChange = listener as () => void;
    });
    const removeEventListener = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { addEventListener, removeEventListener },
    });
    const listCameras = vi
      .fn<() => Promise<MediaDeviceInfo[]>>()
      .mockResolvedValueOnce([cameraDevice("rear-id", "Back Camera")])
      .mockResolvedValueOnce([
        cameraDevice("rear-id", "Back Camera"),
        cameraDevice("usb-id", "USB Camera"),
      ]);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();

    const view = render(
      <CardScanner
        onResult={vi.fn()}
        consentStore={consentStore("allow")}
        deviceStore={deviceStore("rear-id")}
        startCamera={vi.fn(async () => rear.stream)}
        listCameras={listCameras}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    await screen.findByRole("combobox", { name: "Camera" });
    expect(addEventListener).toHaveBeenCalledWith("devicechange", expect.any(Function));

    onDeviceChange?.();
    expect(await screen.findByRole("option", { name: "USB Camera" })).toBeVisible();

    const listener = addEventListener.mock.calls[0]?.[1];
    view.unmount();
    expect(removeEventListener).toHaveBeenCalledWith("devicechange", listener);
  });

  it("asks before the first camera request and remembers allow", async () => {
    const user = userEvent.setup();
    const store = consentStore();
    const requestCamera = vi.fn(() => new Promise<MediaStream>(() => undefined));

    render(
      <CardScanner
        onResult={vi.fn()}
        consentStore={store}
        startCamera={requestCamera}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    expect(screen.getByRole("region", { name: "Camera privacy choice" })).toBeVisible();
    expect(requestCamera).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Allow camera" }));
    expect(requestCamera).toHaveBeenCalledTimes(1);
    expect(store.read()).toBe("allow");
  });

  it("remembers don't allow without requesting the camera and keeps photo choice available", async () => {
    const user = userEvent.setup();
    const store = consentStore();
    const requestCamera = vi.fn(() => new Promise<MediaStream>(() => undefined));
    const view = render(
      <CardScanner
        onResult={vi.fn()}
        consentStore={store}
        startCamera={requestCamera}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    await user.click(screen.getByRole("button", { name: "Don't allow" }));
    expect(store.read()).toBe("deny");
    expect(requestCamera).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/choose photo/i)).toBeEnabled();

    view.unmount();
    render(
      <CardScanner
        onResult={vi.fn()}
        consentStore={store}
        startCamera={requestCamera}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Start camera" }));
    expect(requestCamera).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/camera stays off.*change your camera choice/i);
  });

  it("clears the remembered decision and reopens the privacy choice", async () => {
    const user = userEvent.setup();
    const store = consentStore("deny");
    render(<CardScanner onResult={vi.fn()} consentStore={store} />);

    await user.click(screen.getByRole("button", { name: "Change camera permission" }));

    expect(store.read()).toBeNull();
    expect(screen.getByRole("region", { name: "Camera privacy choice" })).toBeVisible();
  });

  it("explains how to recover when browser site permission is blocked", async () => {
    const user = userEvent.setup();
    const requestCamera = vi.fn(async () => {
      throw new DOMException("blocked", "NotAllowedError");
    });
    render(
      <CardScanner
        onResult={vi.fn()}
        consentStore={consentStore("allow")}
        startCamera={requestCamera}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start camera" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/site settings.*allow camera.*reload.*choose a photo/i);
  });

  it("rejects non-images and oversized images before decoding", async () => {
    await expect(prepareCardImage(new File(["text"], "card.txt", { type: "text/plain" }))).rejects.toThrow("image");
    const large = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "card.jpg", { type: "image/jpeg" });
    await expect(prepareCardImage(large)).rejects.toThrow("10 MB");
  });

  it("keeps a file local, runs OCR once, and cleans it on cancel", async () => {
    const canvas = document.createElement("canvas");
    const prepare = vi.fn(async () => canvas);
    const recognize = vi.fn(async () => ({
      name: "Black Lotus",
      titleCandidates: ["Black Lotus"],
      set: "lea",
      collector: "233",
      rawText: "Black Lotus",
    }));
    const terminate = vi.fn(async () => undefined);
    const onResult = vi.fn();
    const createPreview = vi.fn(async () => "blob:card-photo");
    const revokePreview = vi.fn();

    render(<CardScanner onResult={onResult} prepareImage={prepare} createWorker={async () => ({ recognize, terminate })} createPreview={createPreview} createUpload={vi.fn(async () => { throw new Error("unavailable"); })} revokePreview={revokePreview} />);
    const file = new File(["pixels"], "card.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText(/choose photo/i), { target: { files: [file] } });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({
      hints: expect.objectContaining({ name: "Black Lotus" }),
      previewUrl: "blob:card-photo",
    }));
    expect(screen.queryByRole("img", { name: "Your captured card" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retake photo" })).toBeVisible();
    expect(prepare).toHaveBeenCalledWith(file);
    expect(createPreview).toHaveBeenCalledWith(canvas);
    expect(recognize).toHaveBeenCalledWith(canvas);
    fireEvent.click(screen.getByRole("button", { name: /cancel scan/i }));
    await waitFor(() => expect(terminate).toHaveBeenCalledTimes(1));
    expect(revokePreview).toHaveBeenCalledWith("blob:card-photo");
  });

  it("delivers one transient image blob for private OCR", async () => {
    const canvas = document.createElement("canvas");
    const imageBlob = new Blob(["private pixels"], { type: "image/jpeg" });
    const onResult = vi.fn();
    render(<CardScanner
      onResult={onResult}
      prepareImage={vi.fn(async () => canvas)}
      createWorker={async () => ({
        recognize: vi.fn(async () => ({
          name: "Voja",
          titleCandidates: ["Voja"],
          rawText: "Voja",
        })),
        terminate: vi.fn(async () => undefined),
      })}
      createPreview={vi.fn(async () => "blob:private-card")}
      createUpload={vi.fn(async () => imageBlob)}
    />);

    fireEvent.change(screen.getByLabelText(/choose photo/i), {
      target: { files: [new File(["pixels"], "card.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.objectContaining({
      imageBlob,
      previewUrl: "blob:private-card",
    })));
  });
});

describe("guided card capture", () => {
  it("maps a landscape guide to a card-sized native source crop", () => {
    expect(mapGuideToSource({
      sourceWidth: 1920,
      sourceHeight: 1080,
      videoRect: { x: 0, y: 0, width: 1024, height: 576 },
      guideRect: { x: 358, y: 29, width: 308, height: 518 },
    })).toEqual({ sx: 671, sy: 54, sw: 578, sh: 971 });
  });

  it("removes contain letterboxing before mapping the guide", () => {
    expect(mapGuideToSource({
      sourceWidth: 1920,
      sourceHeight: 1080,
      videoRect: { x: 0, y: 0, width: 500, height: 700 },
      guideRect: { x: 171, y: 220, width: 158, height: 270 },
    })).toEqual({ sx: 657, sy: 41, sw: 607, sh: 1037 });
  });

  it("keeps a quarter-turn capture inside the fixed card guide", () => {
    const stageContext = {
      drawImage: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
    };
    const outputContext = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValueOnce(stageContext as unknown as CanvasRenderingContext2D)
      .mockReturnValueOnce(outputContext as unknown as CanvasRenderingContext2D);
    const video = document.createElement("video");
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    });

    const canvas = captureGuidedCardFrame(video, {
      viewportRect: { x: 0, y: 0, width: 1024, height: 576 },
      guideRect: { x: 358, y: 29, width: 308, height: 518 },
      angle: 90,
      viewZoom: 1,
    });

    expect(canvas.width).toBeLessThanOrEqual(1600);
    expect(canvas.height).toBeLessThanOrEqual(1600);
    expect(canvas.height).toBeGreaterThan(canvas.width);
    expect(stageContext.translate).toHaveBeenCalledWith(800, 450);
    expect(stageContext.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(stageContext.scale).toHaveBeenCalledWith(1, 1);
    expect(outputContext.drawImage).toHaveBeenCalledTimes(1);
  });

  it("renders arbitrary alignment and view zoom before cropping the visible guide", () => {
    const stageContext = {
      drawImage: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
    };
    const outputContext = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValueOnce(stageContext as unknown as CanvasRenderingContext2D)
      .mockReturnValueOnce(outputContext as unknown as CanvasRenderingContext2D);
    const video = document.createElement("video");
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    });

    const canvas = captureGuidedCardFrame(video, {
      viewportRect: { x: 0, y: 0, width: 1024, height: 576 },
      guideRect: { x: 358, y: 29, width: 308, height: 518 },
      angle: 35,
      viewZoom: 1.25,
    });

    expect(stageContext.translate).toHaveBeenCalledWith(800, 450);
    expect(stageContext.rotate).toHaveBeenCalledWith(35 * Math.PI / 180);
    expect(stageContext.scale).toHaveBeenCalledWith(1.25, 1.25);
    expect(stageContext.drawImage).toHaveBeenCalledWith(
      video,
      -800,
      -450,
      1600,
      900,
    );
    expect(canvas.width).toBe(481);
    expect(canvas.height).toBe(809);
    expect(outputContext.drawImage).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      559,
      45,
      481,
      809,
      0,
      0,
      481,
      809,
    );
  });

  it("preprocesses an OCR region without mutating the source canvas", () => {
    const source = document.createElement("canvas");
    source.width = 500;
    source.height = 700;
    const sourcePixels = new Uint8ClampedArray([
      20, 40, 60, 255,
      200, 220, 240, 255,
    ]);
    const getImageData = vi.fn(() => ({ data: sourcePixels.slice(), width: 2, height: 1 }));
    const putImageData = vi.fn();
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValueOnce({ drawImage } as unknown as CanvasRenderingContext2D)
      .mockReturnValueOnce({ getImageData, putImageData } as unknown as CanvasRenderingContext2D);

    const processed = preprocessOcrRegion(source, {
      x: 0,
      y: 0,
      width: 1,
      height: 0.2,
      minimumWidth: 1000,
    });

    expect(processed.width).toBe(1000);
    expect(processed.height).toBe(280);
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 500, 140, 0, 0, 1000, 280);
    expect(getImageData).toHaveBeenCalledWith(0, 0, 1000, 280);
    expect(putImageData).toHaveBeenCalledTimes(1);
    expect(sourcePixels).toEqual(new Uint8ClampedArray([
      20, 40, 60, 255,
      200, 220, 240, 255,
    ]));
  });

  it("isolates light title lettering from a changing colored nameplate", () => {
    const source = document.createElement("canvas");
    source.width = 3;
    source.height = 3;
    const values = [
      90, 100, 110,
      100, 235, 120,
      110, 120, 130,
    ];
    const pixels = new Uint8ClampedArray(values.flatMap((value) => [value, value, value, 255]));
    const putImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValueOnce({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
      .mockReturnValueOnce({
        getImageData: vi.fn(() => ({ data: pixels, width: 3, height: 3 })),
        putImageData,
      } as unknown as CanvasRenderingContext2D);

    preprocessOcrRegion(source, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      preprocessing: "adaptive",
    });

    const output = putImageData.mock.calls[0]?.[0].data as Uint8ClampedArray;
    expect(Array.from(output.slice(16, 20))).toEqual([0, 0, 0, 255]);
    expect(Array.from(output.slice(0, 4))).toEqual([255, 255, 255, 255]);
  });

  it("rejects guides that do not intersect visible video pixels", () => {
    expect(() => mapGuideToSource({
      sourceWidth: 1920,
      sourceHeight: 1080,
      videoRect: { x: 0, y: 0, width: 500, height: 700 },
      guideRect: { x: 20, y: 20, width: 100, height: 100 },
    })).toThrow(/inside the live camera/i);
  });
});

describe("supported inline camera controls", () => {
  function controllableStream(
    capabilities: Record<string, unknown>,
    initialSettings: Record<string, unknown>,
    reject = false,
  ) {
    const settings = { deviceId: "iphone-id", ...initialSettings };
    const applyConstraints = vi.fn(async (constraints: MediaTrackConstraints) => {
      if (reject) throw new DOMException("unsupported", "OverconstrainedError");
      Object.assign(settings, constraints.advanced?.[0]);
    });
    const track = {
      getCapabilities: () => capabilities,
      getSettings: () => settings,
      applyConstraints,
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    return { stream, track, applyConstraints };
  }

  it("renders and applies every capability reported by the active camera", async () => {
    const active = controllableStream({
      zoom: { min: 1, max: 5, step: 0.25 },
      exposureCompensation: { min: -2, max: 2, step: 0.5 },
      focusMode: ["continuous", "manual"],
      focusDistance: { min: 0.1, max: 10, step: 0.1 },
      torch: true,
    }, {
      zoom: 2,
      exposureCompensation: 0,
      focusMode: "continuous",
      focusDistance: 1,
      torch: false,
    });
    const user = userEvent.setup();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<CardScanner
      onResult={vi.fn()}
      consentStore={consentStore("allow")}
      startCamera={vi.fn(async () => active.stream)}
      listCameras={vi.fn(async () => [cameraDevice("iphone-id", "Winterfreezerecords's iPhone Camera")])}
    />);

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    const controls = await screen.findByRole("group", { name: "Camera controls" });
    expect(controls).toContainElement(screen.getByLabelText("Optical zoom"));
    expect(controls).toContainElement(screen.getByLabelText("Exposure"));
    expect(controls).toContainElement(screen.getByLabelText("Focus mode"));
    expect(controls).toContainElement(screen.getByLabelText("Torch"));
    expect(controls).toContainElement(screen.getByLabelText("Fine straighten"));
    expect(controls).toContainElement(screen.getByLabelText("View zoom"));
    expect(screen.queryByLabelText("Focus distance")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Optical zoom"), { target: { value: "3" } });
    await waitFor(() => expect(active.applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 3 }] }));
    await user.selectOptions(screen.getByLabelText("Focus mode"), "manual");
    expect(await screen.findByLabelText("Focus distance")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Focus distance"), { target: { value: "2.4" } });
    await user.click(screen.getByLabelText("Torch"));
    expect(active.applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: "manual" }] });
    expect(active.applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusDistance: 2.4 }] });
    expect(active.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
  });

  it("shows only rotation and supported-control guidance when optical controls are unavailable", async () => {
    const active = controllableStream({}, {});
    const user = userEvent.setup();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<CardScanner
      onResult={vi.fn()}
      consentStore={consentStore("allow")}
      startCamera={vi.fn(async () => active.stream)}
    />);

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    expect(await screen.findByLabelText("Fine straighten")).toBeVisible();
    expect(screen.getByLabelText("View zoom")).toBeVisible();
    expect(screen.getByText(/controls depend on the selected camera and browser/i)).toBeVisible();
    expect(screen.queryByLabelText("Optical zoom")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Exposure")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Torch")).not.toBeInTheDocument();
  });

  it("restores the last working value when a camera constraint fails", async () => {
    const active = controllableStream({ zoom: { min: 1, max: 5, step: 1 } }, { zoom: 2 }, true);
    const user = userEvent.setup();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<CardScanner
      onResult={vi.fn()}
      consentStore={consentStore("allow")}
      startCamera={vi.fn(async () => active.stream)}
    />);

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    const zoom = await screen.findByLabelText("Optical zoom");
    expect(zoom).toHaveValue("2");
    fireEvent.change(zoom, { target: { value: "4" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/zoom could not be changed/i);
    expect(zoom).toHaveValue("2");
  });
});

describe("guided live viewfinder", () => {
  it("shows a non-color-only 5:7 card guide and practical framing instructions", async () => {
    const user = userEvent.setup();
    const active = cameraStream("iphone-id");
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<CardScanner
      onResult={vi.fn()}
      consentStore={consentStore("allow")}
      startCamera={vi.fn(async () => active.stream)}
    />);

    await user.click(screen.getByRole("button", { name: "Start camera" }));

    const viewfinder = await screen.findByRole("region", { name: "Card viewfinder" });
    const guide = screen.getByRole("img", { name: "Card framing guide" });
    expect(viewfinder).toContainElement(screen.getByLabelText("Card camera preview"));
    expect(viewfinder).toContainElement(guide);
    expect(viewfinder).toHaveTextContent(/fill the outline/i);
    expect(viewfinder).toHaveTextContent(/title.*readable/i);
    expect(viewfinder).toHaveTextContent(/avoid glare/i);
  });

  it("uses one fine alignment and view zoom for the live preview and capture", async () => {
    const user = userEvent.setup();
    const active = cameraStream("iphone-id");
    const canvas = document.createElement("canvas");
    const captureFrame = vi.fn(() => canvas);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<CardScanner
      onResult={vi.fn()}
      consentStore={consentStore("allow")}
      startCamera={vi.fn(async () => active.stream)}
      captureFrame={captureFrame}
      createPreview={vi.fn(async () => "blob:aligned")}
      createUpload={vi.fn(async () => { throw new Error("unavailable"); })}
      createWorker={async () => ({
        recognize: vi.fn(async () => ({ name: "Voja", titleCandidates: ["Voja"], rawText: "Voja" })),
        terminate: vi.fn(async () => undefined),
      })}
    />);

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    const video = await screen.findByLabelText("Card camera preview");
    const viewfinder = screen.getByRole("region", { name: "Card viewfinder" });
    const guide = screen.getByRole("img", { name: "Card framing guide" });
    fireEvent.change(screen.getByLabelText("Fine straighten"), { target: { value: "-35" } });
    fireEvent.change(screen.getByLabelText("View zoom"), { target: { value: "1.25" } });

    expect(video).toHaveStyle({ transform: "rotate(-35deg) scale(1.25)" });
    vi.spyOn(viewfinder, "getBoundingClientRect").mockReturnValue({
      x: 10, y: 20, width: 800, height: 450,
    } as DOMRect);
    vi.spyOn(guide, "getBoundingClientRect").mockReturnValue({
      x: 275, y: 35, width: 270, height: 420,
    } as DOMRect);
    await user.click(screen.getByRole("button", { name: "Capture card" }));

    expect(captureFrame).toHaveBeenCalledWith(video, {
      viewportRect: { x: 10, y: 20, width: 800, height: 450 },
      guideRect: { x: 275, y: 35, width: 270, height: 420 },
      angle: -35,
      viewZoom: 1.25,
    });
    expect(localStorage.getItem("wynterlabs.cards.camera-alignment.v2")).toBe(
      '{"orientation":0,"straighten":-35,"viewZoom":1.25}',
    );
  });

  it("captures with the saved shortcut but ignores typing and modified keys", async () => {
    localStorage.setItem("wynterlabs.cards.capture-shortcut.v1", "KeyK");
    const user = userEvent.setup();
    const active = cameraStream("iphone-id");
    const captureFrame = vi.fn(() => document.createElement("canvas"));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<CardScanner
      onResult={vi.fn()}
      consentStore={consentStore("allow")}
      startCamera={vi.fn(async () => active.stream)}
      captureFrame={captureFrame}
      createPreview={vi.fn(async () => "blob:shortcut-card")}
      createUpload={vi.fn(async () => { throw new Error("unavailable"); })}
      createWorker={async () => ({
        recognize: vi.fn(async () => ({ name: "Voja", titleCandidates: ["Voja"], rawText: "Voja" })),
        terminate: vi.fn(async () => undefined),
      })}
    />);

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    await screen.findByLabelText("Card camera preview");
    const shortcutKey = screen.getByText("K", { selector: "kbd" });
    expect(shortcutKey.closest(".scanner-shortcut-hint")).toHaveTextContent("Capture shortcut: K");

    fireEvent.keyDown(screen.getByLabelText("Fine straighten"), { code: "KeyK", key: "k" });
    fireEvent.keyDown(window, { code: "KeyK", key: "k", ctrlKey: true });
    fireEvent.keyDown(window, { code: "KeyJ", key: "j" });
    expect(captureFrame).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { code: "KeyK", key: "k" });
    expect(captureFrame).toHaveBeenCalledTimes(1);
  });

  it("uses Space to capture by default and prevents page scrolling", async () => {
    const user = userEvent.setup();
    const active = cameraStream("iphone-id");
    const captureFrame = vi.fn(() => document.createElement("canvas"));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<CardScanner
      onResult={vi.fn()}
      consentStore={consentStore("allow")}
      startCamera={vi.fn(async () => active.stream)}
      captureFrame={captureFrame}
      createPreview={vi.fn(async () => "blob:space-card")}
      createUpload={vi.fn(async () => { throw new Error("unavailable"); })}
    />);

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    await screen.findByLabelText("Card camera preview");
    const event = new KeyboardEvent("keydown", {
      code: "Space", key: " ", bubbles: true, cancelable: true,
    });
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(captureFrame).toHaveBeenCalledTimes(1);
  });

  it("ignores rapid capture shortcuts until the current recognition finishes", async () => {
    const user = userEvent.setup();
    const active = cameraStream("iphone-id");
    const captureFrame = vi.fn(() => document.createElement("canvas"));
    let finishRecognition!: () => void;
    const recognition = new Promise<{ name: string; titleCandidates: string[]; rawText: string }>((resolve) => {
      finishRecognition = () => resolve({ name: "Voja", titleCandidates: ["Voja"], rawText: "Voja" });
    });
    const recognize = vi.fn(() => recognition);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<CardScanner
      onResult={vi.fn()}
      continuous
      consentStore={consentStore("allow")}
      startCamera={vi.fn(async () => active.stream)}
      captureFrame={captureFrame}
      sampleFingerprint={() => [0]}
      createPreview={vi.fn(async () => "blob:rapid-card")}
      createUpload={vi.fn(async () => { throw new Error("unavailable"); })}
      createWorker={async () => ({ recognize, terminate: vi.fn(async () => undefined) })}
    />);

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    await screen.findByLabelText("Card camera preview");
    fireEvent.keyDown(window, { code: "Space", key: " " });
    fireEvent.keyDown(window, { code: "Space", key: " " });

    expect(captureFrame).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("A card is already being read. Please wait.")).toBeInTheDocument();

    finishRecognition();
    await waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText("Reading card and finding the exact printing…")).not.toBeInTheDocument());

    fireEvent.keyDown(window, { code: "Space", key: " " });
    await waitFor(() => expect(captureFrame).toHaveBeenCalledTimes(2));
  });

  it("keeps stable-frame capture disabled when a continuous session requires explicit capture", async () => {
    const user = userEvent.setup();
    const active = cameraStream("iphone-id");
    const captureFrame = vi.fn(() => document.createElement("canvas"));
    const onResult = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<CardScanner
      onResult={onResult}
      continuous
      stableFrameAutoCapture={false}
      consentStore={consentStore("allow")}
      startCamera={vi.fn(async () => active.stream)}
      captureFrame={captureFrame}
      sampleFingerprint={() => [0]}
      sampleIntervalMs={10}
    />);

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    await screen.findByLabelText("Card camera preview");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onResult).not.toHaveBeenCalled();
    expect(captureFrame).not.toHaveBeenCalled();
    expect(screen.getByText(/choose capture now/i)).toBeVisible();
  });

  it("restores, rotates, and resets the browser-local camera view", async () => {
    localStorage.setItem(
      "wynterlabs.cards.camera-alignment.v2",
      '{"orientation":90,"straighten":10,"viewZoom":1.5}',
    );
    const user = userEvent.setup();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<CardScanner
      onResult={vi.fn()}
      consentStore={consentStore("allow")}
      startCamera={vi.fn(async () => cameraStream("iphone-id").stream)}
    />);

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    const video = await screen.findByLabelText("Card camera preview");
    expect(video).toHaveStyle({ transform: "rotate(100deg) scale(1.5)" });

    await user.click(screen.getByRole("button", { name: "Rotate right" }));
    expect(video).toHaveStyle({ transform: "rotate(-170deg) scale(1.5)" });
    await user.click(screen.getByRole("button", { name: "Rotate left" }));
    expect(video).toHaveStyle({ transform: "rotate(100deg) scale(1.5)" });

    await user.click(screen.getByRole("button", { name: "Reset view" }));
    expect(video).toHaveStyle({ transform: "rotate(0deg) scale(1)" });
    expect(screen.getByLabelText("Fine straighten")).toHaveValue("0");
    expect(screen.getByLabelText("View zoom")).toHaveValue("1");
    expect(localStorage.getItem("wynterlabs.cards.camera-alignment.v2")).toBe(
      '{"orientation":0,"straighten":0,"viewZoom":1}',
    );
  });

  it("captures only the measured guide and keeps the working stream alive", async () => {
    const user = userEvent.setup();
    const active = cameraStream("iphone-id");
    const canvas = document.createElement("canvas");
    const captureFrame = vi.fn(() => canvas);
    const createPreview = vi.fn(async () => "blob:guided-card");
    const recognize = vi.fn(async () => ({
      name: "Voja, Jaws of the Conclave",
      titleCandidates: ["Voja, Jaws of the Conclave"],
      rawText: "Voja, Jaws of the Conclave",
    }));
    const onResult = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<CardScanner
      onResult={onResult}
      consentStore={consentStore("allow")}
      startCamera={vi.fn(async () => active.stream)}
      captureFrame={captureFrame}
      createPreview={createPreview}
      createUpload={vi.fn(async () => { throw new Error("unavailable"); })}
      createWorker={async () => ({ recognize, terminate: vi.fn(async () => undefined) })}
    />);

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    const video = await screen.findByLabelText("Card camera preview");
    const viewfinder = screen.getByRole("region", { name: "Card viewfinder" });
    const guide = screen.getByRole("img", { name: "Card framing guide" });
    vi.spyOn(viewfinder, "getBoundingClientRect").mockReturnValue({
      x: 10, y: 20, width: 800, height: 450,
    } as DOMRect);
    vi.spyOn(guide, "getBoundingClientRect").mockReturnValue({
      x: 275, y: 35, width: 270, height: 420,
    } as DOMRect);

    await user.click(screen.getByRole("button", { name: "Capture card" }));

    expect(captureFrame).toHaveBeenCalledWith(video, {
      viewportRect: { x: 10, y: 20, width: 800, height: 450 },
      guideRect: { x: 275, y: 35, width: 270, height: 420 },
      angle: 0,
      viewZoom: 1,
    });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({
      hints: expect.objectContaining({ name: "Voja, Jaws of the Conclave" }),
      previewUrl: "blob:guided-card",
    }));
    expect(active.stop).not.toHaveBeenCalled();
    expect(createPreview).toHaveBeenCalledWith(canvas);
    expect(recognize).toHaveBeenCalledWith(canvas);
  });

  it("resumes the same stream and worker when the page starts the next card", async () => {
    const user = userEvent.setup();
    const active = cameraStream("iphone-id");
    const canvas = document.createElement("canvas");
    const recognize = vi.fn(async () => ({
      name: "Black Lotus",
      titleCandidates: ["Black Lotus"],
      rawText: "Black Lotus",
    }));
    const terminate = vi.fn(async () => undefined);
    const createWorker = vi.fn(async () => ({ recognize, terminate }));
    const props = {
      onResult: vi.fn(),
      consentStore: consentStore("allow" as const),
      startCamera: vi.fn(async () => active.stream),
      captureFrame: vi.fn(() => canvas),
      createPreview: vi.fn(async () => "blob:rapid-card"),
      createUpload: vi.fn(async () => { throw new Error("unavailable"); }),
      createWorker,
      revokePreview: vi.fn(),
    };
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const { rerender } = render(<CardScanner {...props} nextCardSignal={0} />);

    await user.click(screen.getByRole("button", { name: "Start camera" }));
    await screen.findByLabelText("Card camera preview");
    await user.click(screen.getByRole("button", { name: "Capture card" }));
    await waitFor(() => expect(props.onResult).toHaveBeenCalledTimes(1));

    rerender(<CardScanner {...props} nextCardSignal={1} />);

    expect(await screen.findByLabelText("Card camera preview")).toBeVisible();
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(active.stop).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /cancel scan/i }));
    await waitFor(() => expect(terminate).toHaveBeenCalledTimes(1));
  });
});
