import { afterEach, expect, it, vi } from "vitest";

import {
  browserCameraDeviceStore,
  CAMERA_DEVICE_KEY,
  listCardCameras,
} from "./camera-device";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("remembers and clears one selected camera on this browser", () => {
  expect(browserCameraDeviceStore.read()).toBeNull();

  browserCameraDeviceStore.write("rear-id");
  expect(localStorage.getItem(CAMERA_DEVICE_KEY)).toBe("rear-id");
  expect(browserCameraDeviceStore.read()).toBe("rear-id");

  browserCameraDeviceStore.clear();
  expect(browserCameraDeviceStore.read()).toBeNull();
});

it("lists only browser video inputs", async () => {
  const rear = { deviceId: "rear-id", groupId: "group", kind: "videoinput", label: "Back Camera", toJSON: vi.fn() } as MediaDeviceInfo;
  const microphone = { deviceId: "mic-id", groupId: "group", kind: "audioinput", label: "Microphone", toJSON: vi.fn() } as MediaDeviceInfo;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { enumerateDevices: vi.fn(async () => [rear, microphone]) },
  });

  expect(await listCardCameras()).toEqual([rear]);
});

it("returns an empty camera list when enumeration is unavailable", async () => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });

  expect(await listCardCameras()).toEqual([]);
});
