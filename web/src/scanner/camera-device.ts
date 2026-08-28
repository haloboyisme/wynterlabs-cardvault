export const CAMERA_DEVICE_KEY = "wynterlabs.cards.camera-device.v1";

export interface CameraDeviceStore {
  read(): string | null;
  write(deviceId: string): void;
  clear(): void;
}

export const browserCameraDeviceStore: CameraDeviceStore = {
  read() {
    try {
      return localStorage.getItem(CAMERA_DEVICE_KEY) || null;
    } catch {
      return null;
    }
  },

  write(deviceId) {
    try {
      localStorage.setItem(CAMERA_DEVICE_KEY, deviceId);
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  },

  clear() {
    try {
      localStorage.removeItem(CAMERA_DEVICE_KEY);
    } catch {
      // Component state still recovers when storage is unavailable.
    }
  },
};

export async function listCardCameras(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "videoinput");
}
