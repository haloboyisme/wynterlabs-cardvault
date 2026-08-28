import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import {
  browserCameraConsentStore,
  type CameraConsent,
  type CameraConsentStore,
} from "../scanner/camera-consent";
import {
  browserCameraDeviceStore,
  listCardCameras,
  type CameraDeviceStore,
} from "../scanner/camera-device";
import {
  canvasPreviewUrl,
  canvasUploadBlob,
  captureGuidedCardFrame,
  prepareCardImage,
  startCardCamera,
  stopCardCamera,
} from "../scanner/capture";
import {
  applyCameraControl,
  readCameraControls,
  type CameraControlName,
  type CameraControlState,
} from "../scanner/camera-controls";
import {
  DEFAULT_CAMERA_ALIGNMENT,
  effectiveCameraAngle,
  parseCameraAlignment,
  rotateCameraOrientation,
  serializeCameraAlignment,
  type CameraAlignment,
} from "../scanner/camera-alignment";
import { createCardOcrWorker, type CardOcrWorker, type OcrHints } from "../scanner/ocr";
import {
  advanceFrameDetector,
  createFrameDetector,
  type FrameDetectorState,
  type FrameFingerprint,
} from "../scanner/multi-card-detector";
import {
  captureShortcutLabel,
  readCaptureShortcut,
  shouldCaptureFromKeyboard,
} from "../scanner/capture-shortcut";

export interface CapturedScan {
  hints: OcrHints;
  previewUrl: string;
  imageBlob?: Blob;
}

interface Props {
  onResult: (result: CapturedScan) => void;
  onReset?: () => void;
  nextCardSignal?: number;
  prepareImage?: typeof prepareCardImage;
  createWorker?: typeof createCardOcrWorker;
  consentStore?: CameraConsentStore;
  deviceStore?: CameraDeviceStore;
  startCamera?: typeof startCardCamera;
  listCameras?: typeof listCardCameras;
  createPreview?: typeof canvasPreviewUrl;
  createUpload?: typeof canvasUploadBlob;
  captureFrame?: typeof captureGuidedCardFrame;
  revokePreview?: (url: string) => void;
  continuous?: boolean;
  captureCount?: number;
  maximumCaptures?: number;
  sampleIntervalMs?: number;
  countdownStepMs?: number;
  sampleFingerprint?: (canvas: HTMLCanvasElement) => FrameFingerprint;
  topControls?: ReactNode;
}

const cameraPermissionBlocked = (reason: unknown) => {
  const name = reason && typeof reason === "object" && "name" in reason ? reason.name : null;
  return name === "NotAllowedError" || name === "SecurityError";
};

const cameraUnavailable = (reason: unknown) => {
  const name = reason && typeof reason === "object" && "name" in reason ? reason.name : null;
  return name === "NotFoundError" || name === "OverconstrainedError";
};

const CAMERA_ALIGNMENT_KEY = "wynterlabs.cards.camera-alignment.v2";
const emptyControls = (): CameraControlState => ({ focusModes: [] });
const revokeObjectUrl = (url: string) => URL.revokeObjectURL?.(url);

const canvasFingerprint = (source: HTMLCanvasElement): FrameFingerprint => {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext("2d");
  if (!context) return [];
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const values: number[] = [];
  for (let index = 0; index < pixels.length; index += 4) {
    values.push(Math.round(
      pixels[index]! * 0.299 + pixels[index + 1]! * 0.587 + pixels[index + 2]! * 0.114,
    ));
  }
  return values;
};

const readAlignment = (): CameraAlignment => {
  try {
    return parseCameraAlignment(localStorage.getItem(CAMERA_ALIGNMENT_KEY));
  } catch {
    return { ...DEFAULT_CAMERA_ALIGNMENT };
  }
};

const writeAlignment = (value: CameraAlignment) => {
  try {
    localStorage.setItem(CAMERA_ALIGNMENT_KEY, serializeCameraAlignment(value));
  } catch {
    // Alignment still applies for the current private browser session.
  }
};

export function CardScanner({
  onResult,
  prepareImage = prepareCardImage,
  createWorker = createCardOcrWorker,
  consentStore = browserCameraConsentStore,
  deviceStore = browserCameraDeviceStore,
  startCamera = startCardCamera,
  listCameras = listCardCameras,
  createPreview = canvasPreviewUrl,
  createUpload = canvasUploadBlob,
  captureFrame = captureGuidedCardFrame,
  revokePreview = revokeObjectUrl,
  onReset,
  nextCardSignal = 0,
  continuous = false,
  captureCount = 0,
  maximumCaptures = 250,
  sampleIntervalMs = 750,
  countdownStepMs = 1_000,
  sampleFingerprint = canvasFingerprint,
  topControls,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewfinderRef = useRef<HTMLElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<CardOcrWorker | null>(null);
  const previewRef = useRef("");
  const generation = useRef(0);
  const activeOcrRequest = useRef(0);
  const previousNextCardSignal = useRef(nextCardSignal);
  const detectorRef = useRef<FrameDetectorState>(createFrameDetector());
  const busyRef = useRef(false);
  const [camera, setCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [switchingCamera, setSwitchingCamera] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewDelivered, setPreviewDelivered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState<CameraConsent>(() => consentStore.read());
  const [choosingConsent, setChoosingConsent] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("");
  const [captureStatus, setCaptureStatus] = useState("");
  const [controls, setControls] = useState<CameraControlState>(emptyControls);
  const [controlBusy, setControlBusy] = useState(false);
  const [alignment, setAlignment] = useState<CameraAlignment>(readAlignment);
  const [autoStatus, setAutoStatus] = useState("");
  const [autoCountdown, setAutoCountdown] = useState<number | null>(null);
  const [captureShortcut] = useState(readCaptureShortcut);

  const changeAlignment = (transform: (current: CameraAlignment) => CameraAlignment) => {
    setAlignment((current) => {
      const next = transform(current);
      writeAlignment(next);
      return next;
    });
  };

  const clearPreview = () => {
    if (previewRef.current) revokePreview(previewRef.current);
    previewRef.current = "";
    setPreviewUrl("");
    setPreviewDelivered(false);
  };

  const replacePreview = (url: string) => {
    clearPreview();
    previewRef.current = url;
    setPreviewUrl(url);
  };

  const dispose = async () => {
    generation.current += 1;
    busyRef.current = false;
    setBusy(false);
    setCaptureStatus("");
    setAutoCountdown(null);
    setAutoStatus("");
    stopCardCamera(streamRef.current);
    streamRef.current = null;
    setCameraStream(null);
    setCamera(false);
    setControls(emptyControls());
    clearPreview();
    const worker = workerRef.current;
    workerRef.current = null;
    if (worker) await worker.terminate();
  };

  useEffect(() => {
    const video = videoRef.current;
    const stream = cameraStream;
    if (!camera || !video || !stream) return;
    video.srcObject = stream;
    void video.play();
    return () => {
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [camera, cameraStream]);

  useEffect(() => () => {
    void dispose();
  }, []);

  useEffect(() => {
    if (previousNextCardSignal.current === nextCardSignal) return;
    previousNextCardSignal.current = nextCardSignal;
    generation.current += 1;
    clearPreview();
    setError("");
    setProgress(0);
    busyRef.current = false;
    setBusy(false);
    if (streamRef.current) {
      setCameraStream(streamRef.current);
      setCamera(true);
    }
  }, [nextCardSignal]);

  const recognize = async (canvas: HTMLCanvasElement, lockOwned = false) => {
    if (busyRef.current && !lockOwned) {
      setCaptureStatus("A card is already being read. Please wait.");
      return;
    }
    busyRef.current = true;
    const request = ++generation.current;
    activeOcrRequest.current = request;
    setBusy(true);
    setCaptureStatus("Reading card and finding the exact printing…");
    setError("");
    setProgress(0);
    let resultPreview = "";
    let transferred = false;
    try {
      const imageUrl = await createPreview(canvas);
      resultPreview = imageUrl;
      if (request !== generation.current) {
        revokePreview(imageUrl);
        resultPreview = "";
        return;
      }
      if (!continuous) replacePreview(imageUrl);
      const upload = createUpload(canvas).catch(() => undefined);
      let worker = workerRef.current;
      if (!worker) {
        worker = await createWorker((value) => {
          if (activeOcrRequest.current === generation.current) setProgress(value);
        });
        if (request !== generation.current) {
          await worker.terminate();
          return;
        }
        workerRef.current = worker;
      }
      const hints = await worker.recognize(canvas);
      const imageBlob = await upload;
      if (request === generation.current) {
        onResult({ hints, previewUrl: imageUrl, ...(imageBlob ? { imageBlob } : {}) });
        transferred = continuous;
        if (!continuous) setPreviewDelivered(true);
      }
    } catch (reason) {
      if (request === generation.current) {
        setError(reason instanceof Error ? reason.message : "The card could not be read.");
      }
    } finally {
      if (continuous && resultPreview && !transferred) revokePreview(resultPreview);
      if (request === generation.current) {
        busyRef.current = false;
        setBusy(false);
        setCaptureStatus("");
      }
    }
  };

  const refreshCameraList = useCallback(async (stream: MediaStream, requestedDeviceId = "") => {
    try {
      const devices = await listCameras();
      setCameraDevices(devices);
      if (devices.length === 0) {
        setCameraStatus("This browser cannot list alternate cameras. The current camera remains available.");
        return;
      }
      const activeDeviceId = stream.getVideoTracks?.()[0]?.getSettings?.().deviceId
        ?? requestedDeviceId
        ?? devices[0]?.deviceId
        ?? "";
      const availableDeviceId = devices.some((device) => device.deviceId === activeDeviceId)
        ? activeDeviceId
        : devices[0]?.deviceId ?? "";
      setSelectedDeviceId(availableDeviceId);
      if (availableDeviceId) deviceStore.write(availableDeviceId);
    } catch {
      setCameraDevices([]);
      setCameraStatus("This browser could not list alternate cameras. The current camera remains available.");
    }
  }, [deviceStore, listCameras]);

  const refreshCameraControls = (stream: MediaStream) => {
    const track = stream.getVideoTracks?.()[0];
    setControls(track ? readCameraControls(track) : emptyControls());
  };

  const changeControl = async (
    control: CameraControlName,
    value: number | string | boolean,
    label: string,
  ) => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track || controlBusy) return;
    const previous = controls;
    setControlBusy(true);
    setError("");
    try {
      await applyCameraControl(track, control, value);
      setControls(readCameraControls(track));
    } catch {
      setControls(previous);
      setError(`${label} could not be changed. The last working camera setting is still active.`);
    } finally {
      setControlBusy(false);
    }
  };

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const refresh = () => {
      const stream = streamRef.current;
      if (stream) void refreshCameraList(stream, selectedDeviceId);
    };
    mediaDevices.addEventListener("devicechange", refresh);
    return () => mediaDevices.removeEventListener("devicechange", refresh);
  }, [refreshCameraList, selectedDeviceId]);

  const openCamera = async () => {
    setError("");
    setCameraStatus("");
    try {
      const rememberedDeviceId = deviceStore.read();
      let stream: MediaStream;
      try {
        stream = await startCamera(rememberedDeviceId ?? undefined);
      } catch (reason) {
        if (!rememberedDeviceId || !cameraUnavailable(reason)) throw reason;
        deviceStore.clear();
        stream = await startCamera(undefined);
      }
      detectorRef.current = createFrameDetector();
      setAutoCountdown(null);
      setAutoStatus("");
      streamRef.current = stream;
      setCameraStream(stream);
      setCamera(true);
      refreshCameraControls(stream);
      await refreshCameraList(stream, rememberedDeviceId ?? "");
    } catch (reason) {
      setError(
        cameraPermissionBlocked(reason)
          ? "Camera access is blocked in this browser's site settings. Allow Camera for this WynterLabs site, reload the page, or choose a photo instead."
          : reason instanceof Error
            ? reason.message
            : "The camera could not be started.",
      );
    }
  };

  const switchCamera = async (deviceId: string) => {
    const previousStream = streamRef.current;
    const previousDeviceId = selectedDeviceId;
    if (!previousStream || deviceId === previousDeviceId) return;
    setSwitchingCamera(true);
    setSelectedDeviceId(deviceId);
    setError("");
    setCameraStatus("");
    try {
      const replacement = await startCamera(deviceId);
      streamRef.current = replacement;
      setCameraStream(replacement);
      setSelectedDeviceId(deviceId);
      deviceStore.write(deviceId);
      refreshCameraControls(replacement);
      stopCardCamera(previousStream);
      await refreshCameraList(replacement, deviceId);
    } catch {
      setSelectedDeviceId(previousDeviceId);
      setError("The camera could not be changed. The current camera is still available.");
    } finally {
      setSwitchingCamera(false);
    }
  };

  const requestCamera = () => {
    setError("");
    setCameraStatus("");
    if (consent === null) {
      setChoosingConsent(true);
      return;
    }
    if (consent === "deny") {
      setCameraStatus("Camera stays off on this browser. Choose a photo or change your camera choice.");
      return;
    }
    void openCamera();
  };

  const chooseConsent = (choice: Exclude<CameraConsent, null>) => {
    consentStore.write(choice);
    setConsent(choice);
    setChoosingConsent(false);
    setError("");
    if (choice === "allow") {
      void openCamera();
      return;
    }
    setCameraStatus("Camera stays off on this browser. Choose a photo or change your camera choice.");
  };

  const resetConsent = async () => {
    await dispose();
    consentStore.clear();
    setConsent(null);
    setChoosingConsent(true);
    setCameraStatus("");
    setError("");
  };

  const captureCameraCanvas = useCallback(() => {
    const video = videoRef.current;
    const viewfinder = viewfinderRef.current;
    const guide = guideRef.current;
    if (!video || !viewfinder || !guide) throw new Error("The card guide is not ready yet.");
    const viewportBounds = viewfinder.getBoundingClientRect();
    const guideBounds = guide.getBoundingClientRect();
    return captureFrame(video, {
      viewportRect: {
        x: viewportBounds.x,
        y: viewportBounds.y,
        width: viewportBounds.width,
        height: viewportBounds.height,
      },
      guideRect: {
        x: guideBounds.x,
        y: guideBounds.y,
        width: guideBounds.width,
        height: guideBounds.height,
      },
      angle: effectiveCameraAngle(alignment),
      viewZoom: alignment.viewZoom,
    });
  }, [alignment, captureFrame]);

  const capture = () => {
    if (busyRef.current) {
      setCaptureStatus("A card is already being read. Please wait.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setCaptureStatus("Preparing photo…");
    try {
      setAutoCountdown(null);
      const canvas = captureCameraCanvas();
      if (continuous) {
        const fingerprint = sampleFingerprint(canvas);
        detectorRef.current = {
          ...createFrameDetector(),
          phase: "awaiting_change",
          stableCount: 3,
          previous: fingerprint,
          captured: fingerprint,
          shouldCapture: false,
        };
        setAutoStatus("Card captured. Remove it or show the next card.");
      }
      if (!continuous) setCamera(false);
      void recognize(canvas, true);
    } catch (reason) {
      busyRef.current = false;
      setBusy(false);
      setCaptureStatus("");
      setError(reason instanceof Error ? reason.message : "The camera could not capture a card.");
    }
  };

  useEffect(() => {
    if (!camera || switchingCamera || captureCount >= maximumCaptures) return;
    const handleCaptureShortcut = (event: KeyboardEvent) => {
      if (!shouldCaptureFromKeyboard(event, captureShortcut)) return;
      event.preventDefault();
      capture();
    };
    window.addEventListener("keydown", handleCaptureShortcut);
    return () => window.removeEventListener("keydown", handleCaptureShortcut);
  }, [camera, switchingCamera, captureCount, maximumCaptures, captureShortcut, capture]);

  useEffect(() => {
    if (!continuous || !camera || captureCount >= maximumCaptures || autoCountdown !== null) return;
    const timer = window.setInterval(() => {
      if (busyRef.current) return;
      try {
        const canvas = captureCameraCanvas();
        detectorRef.current = advanceFrameDetector(
          detectorRef.current,
          sampleFingerprint(canvas),
        );
        if (detectorRef.current.shouldCapture) {
          setAutoCountdown(5);
          setAutoStatus("Capturing in 5… Keep the card steady.");
        } else if (detectorRef.current.phase === "awaiting_change") {
          setAutoStatus("Remove this card or show the next card.");
        } else {
          setAutoStatus("Hold one card steady inside the guide.");
        }
      } catch {
        setAutoStatus("Hold one card steady inside the guide, or use Capture now.");
      }
    }, sampleIntervalMs);
    return () => window.clearInterval(timer);
  }, [
    autoCountdown,
    camera,
    captureCameraCanvas,
    captureCount,
    continuous,
    maximumCaptures,
    sampleFingerprint,
    sampleIntervalMs,
  ]);

  useEffect(() => {
    if (!continuous || !camera || autoCountdown === null || captureCount >= maximumCaptures) return;
    const timer = window.setTimeout(() => {
      if (busyRef.current) {
        setAutoCountdown(null);
        return;
      }
      try {
        const canvas = captureCameraCanvas();
        detectorRef.current = advanceFrameDetector(
          detectorRef.current,
          sampleFingerprint(canvas),
        );
        if (detectorRef.current.phase !== "awaiting_change") {
          setAutoCountdown(null);
          setAutoStatus("Card moved. Hold it steady to restart the countdown.");
          return;
        }
        if (autoCountdown > 1) {
          const next = autoCountdown - 1;
          setAutoCountdown(next);
          setAutoStatus(`Capturing in ${next}… Keep the card steady.`);
          return;
        }
        setAutoCountdown(null);
        setAutoStatus("Card captured. Remove it or show the next card.");
        void recognize(canvas);
      } catch {
        setAutoCountdown(null);
        setAutoStatus("The countdown stopped. Hold the card steady to try again.");
      }
    }, countdownStepMs);
    return () => window.clearTimeout(timer);
  }, [
    autoCountdown,
    camera,
    captureCameraCanvas,
    captureCount,
    continuous,
    countdownStepMs,
    maximumCaptures,
    recognize,
    sampleFingerprint,
  ]);

  /*
   * Automatic capture uses the stable-card detector to start the countdown,
   * then rechecks the live frame on every number before reading the card.
   */
  const automaticCaptureFeedback = autoCountdown === null
    ? null
    : {
        value: autoCountdown,
      };

  const retake = async () => {
    generation.current += 1;
    clearPreview();
    setError("");
    setProgress(0);
    busyRef.current = false;
    setBusy(false);
    setCaptureStatus("");
    onReset?.();
    if (streamRef.current) {
      setCameraStream(streamRef.current);
      setCamera(true);
    } else {
      requestCamera();
    }
  };

  return (
    <section className="card-scanner" aria-labelledby="scanner-capture-title">
      <h2 id="scanner-capture-title">{continuous ? "Scan multiple cards" : "Scan one card"}</h2>
      <p>Your photos are processed only by this browser and your private WynterLabs server, then discarded.</p>
      <section className="scanner-control-bar scanner-capture-control-bar" aria-label="Scanner controls">
        {topControls}
        {!camera && !busy && !choosingConsent && !previewUrl && <button className="scanner-capture-action" type="button" onClick={requestCamera}>Start camera</button>}
        {choosingConsent && !camera && !busy && (
          <section className="state-panel" aria-labelledby="camera-privacy-choice-title">
            <h3 id="camera-privacy-choice-title">Camera privacy choice</h3>
            <p>Allow camera access for scanning one card? Your choice stays only in this browser. Captures go only to your private WynterLabs server for in-memory recognition and are never stored.</p>
            <div className="form-actions">
              <button type="button" onClick={() => chooseConsent("allow")}>Allow camera</button>
              <button type="button" onClick={() => chooseConsent("deny")}>Don't allow</button>
            </div>
          </section>
        )}
        {camera && cameraDevices.length > 0 && (
          <label className="scanner-camera-select">
            Camera
            <select
              value={selectedDeviceId}
              disabled={switchingCamera}
              onChange={(event) => void switchCamera(event.currentTarget.value)}
            >
              {cameraDevices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="scanner-live-feedback" aria-live="polite">
          {continuous && <p className="scanner-live-status" role="status">{captureCount >= maximumCaptures
            ? `Session limit reached (${maximumCaptures} cards).`
            : autoStatus || "Hold one card steady inside the guide."}</p>}
          {captureStatus && <p className="scanner-live-status" role="status">{captureStatus}{busy && progress > 0 ? ` ${Math.round(progress * 100)}%` : ""}</p>}
          {cameraStatus && <p className="scanner-live-status" role="status">{cameraStatus}</p>}
        </div>
      </section>
      {camera && (
        <section className="scanner-camera-stage" aria-labelledby="live-camera-title">
          <h3 id="live-camera-title">Live camera</h3>
          <p>{continuous
            ? "Keep one card inside the guide. It captures automatically when steady."
            : "Center one card inside the preview, then capture it."}</p>
          <fieldset className="scanner-camera-controls" aria-label="Camera controls">
            <legend>Camera controls</legend>
            <p>Optical controls depend on the selected camera and browser. Image alignment always works here.</p>
            {controls.zoom && <label>
              Optical zoom
              <input
                type="range"
                min={controls.zoom.min}
                max={controls.zoom.max}
                step={controls.zoom.step}
                value={controls.zoom.value}
                disabled={controlBusy}
                onChange={(event) => void changeControl("zoom", Number(event.target.value), "Zoom")}
              />
            </label>}
            {controls.exposure && <label>
              Exposure
              <input
                type="range"
                min={controls.exposure.min}
                max={controls.exposure.max}
                step={controls.exposure.step}
                value={controls.exposure.value}
                disabled={controlBusy}
                onChange={(event) => void changeControl(
                  controls.exposure!.property,
                  Number(event.target.value),
                  "Exposure",
                )}
              />
            </label>}
            {controls.focusModes.length > 1 && <label>
              Focus mode
              <select
                value={controls.focusMode}
                disabled={controlBusy}
                onChange={(event) => void changeControl("focusMode", event.target.value, "Focus")}
              >
                {controls.focusModes.map((mode) => <option value={mode} key={mode}>{mode}</option>)}
              </select>
            </label>}
            {controls.focusMode === "manual" && controls.focusDistance && <label>
              Focus distance
              <input
                type="range"
                min={controls.focusDistance.min}
                max={controls.focusDistance.max}
                step={controls.focusDistance.step}
                value={controls.focusDistance.value}
                disabled={controlBusy}
                onChange={(event) => void changeControl(
                  "focusDistance",
                  Number(event.target.value),
                  "Focus distance",
                )}
              />
            </label>}
            {controls.torch && <label className="scanner-toggle-control">
              <input
                type="checkbox"
                checked={controls.torch.value}
                disabled={controlBusy}
                onChange={(event) => void changeControl("torch", event.target.checked, "Torch")}
              />
              Torch
            </label>}
            <div className="scanner-alignment-actions">
              <button
                type="button"
                onClick={() => changeAlignment((current) => ({
                  ...current,
                  orientation: rotateCameraOrientation(current.orientation, "left"),
                }))}
              >
                Rotate left
              </button>
              <button
                type="button"
                onClick={() => changeAlignment((current) => ({
                  ...current,
                  orientation: rotateCameraOrientation(current.orientation, "right"),
                }))}
              >
                Rotate right
              </button>
              <button
                type="button"
                onClick={() => changeAlignment(() => ({ ...DEFAULT_CAMERA_ALIGNMENT }))}
              >
                Reset view
              </button>
            </div>
            <label>
              Fine straighten
              <input
                type="range"
                min={-45}
                max={45}
                step={1}
                value={alignment.straighten}
                onChange={(event) => changeAlignment((current) => ({
                  ...current,
                  straighten: Number(event.target.value),
                }))}
              />
              <output>{alignment.straighten}°</output>
            </label>
            <label>
              View zoom
              <input
                type="range"
                min={1}
                max={2}
                step={0.05}
                value={alignment.viewZoom}
                onChange={(event) => changeAlignment((current) => ({
                  ...current,
                  viewZoom: Number(event.target.value),
                }))}
              />
              <output>{alignment.viewZoom.toFixed(2)}×</output>
            </label>
          </fieldset>
          <section ref={viewfinderRef} className="scanner-viewfinder" aria-label="Card viewfinder">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              aria-label="Card camera preview"
              style={{
                transform: `rotate(${effectiveCameraAngle(alignment)}deg) scale(${alignment.viewZoom})`,
              }}
            />
            <div
              ref={guideRef}
              className="scanner-card-guide"
              role="img"
              aria-label="Card framing guide"
            >
              <span className="scanner-card-guide-corners" aria-hidden="true" />
              <span>Fill the outline. Keep the title readable and avoid glare.</span>
            </div>
            {automaticCaptureFeedback && (
              <div
                className="scanner-capture-countdown"
                role="status"
                aria-live="assertive"
                aria-atomic="true"
                aria-label="Automatic capture countdown"
              >
                <strong>{automaticCaptureFeedback.value}</strong>
                <span>Keep card steady</span>
              </div>
            )}
          </section>
          <button
            className="scanner-capture-action"
            type="button"
            disabled={switchingCamera || busy || (continuous && captureCount >= maximumCaptures)}
            onClick={capture}
          >
            {continuous ? "Capture now" : "Capture card"}
          </button>
          <p className="scanner-shortcut-hint">Capture shortcut: <kbd>{captureShortcutLabel(captureShortcut)}</kbd></p>
        </section>
      )}
      {previewUrl && !previewDelivered && (
        <section className="scanner-captured-stage" aria-labelledby="captured-photo-title">
          <h3 id="captured-photo-title">Your photo</h3>
          <img src={previewUrl} alt="Your captured card" />
          {!busy && <button type="button" onClick={() => void retake()}>Retake photo</button>}
        </section>
      )}
      {previewUrl && previewDelivered && !busy && (
        <button type="button" onClick={() => void retake()}>Retake photo</button>
      )}
      {consent !== null && !busy && (
        <button type="button" onClick={() => void resetConsent()}>Change camera permission</button>
      )}
      <label>
        Choose photo
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) {
              clearPreview();
              onReset?.();
              void prepareImage(file).then(recognize).catch((reason) =>
                setError(reason instanceof Error ? reason.message : "The photo could not be opened."),
              );
            }
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={() => { onReset?.(); void dispose(); }}>
        {continuous ? "Stop scanning" : "Cancel scan"}
      </button>
    </section>
  );
}
