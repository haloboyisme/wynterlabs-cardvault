const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 1600;

export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface GuideGeometry {
  sourceWidth: number;
  sourceHeight: number;
  videoRect: ViewRect;
  guideRect: ViewRect;
}

export interface GuidedCaptureOptions {
  viewportRect: ViewRect;
  guideRect: ViewRect;
  angle: number;
  viewZoom: number;
}

export interface OcrRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  minimumWidth?: number;
  preprocessing?: "contrast" | "adaptive";
}

const finitePositive = (value: number) => Number.isFinite(value) && value > 0;

export function mapGuideToSource({
  sourceWidth,
  sourceHeight,
  videoRect,
  guideRect,
}: GuideGeometry): SourceCrop {
  if (
    !finitePositive(sourceWidth)
    || !finitePositive(sourceHeight)
    || !finitePositive(videoRect.width)
    || !finitePositive(videoRect.height)
    || !finitePositive(guideRect.width)
    || !finitePositive(guideRect.height)
  ) {
    throw new Error("The live camera guide is not ready.");
  }
  const scale = Math.min(videoRect.width / sourceWidth, videoRect.height / sourceHeight);
  const contentWidth = sourceWidth * scale;
  const contentHeight = sourceHeight * scale;
  const contentX = videoRect.x + (videoRect.width - contentWidth) / 2;
  const contentY = videoRect.y + (videoRect.height - contentHeight) / 2;
  const left = Math.max(contentX, guideRect.x);
  const top = Math.max(contentY, guideRect.y);
  const right = Math.min(contentX + contentWidth, guideRect.x + guideRect.width);
  const bottom = Math.min(contentY + contentHeight, guideRect.y + guideRect.height);
  if (right <= left || bottom <= top) {
    throw new Error("Place the card guide inside the live camera image.");
  }
  const sx = Math.max(0, Math.round((left - contentX) / scale));
  const sy = Math.max(0, Math.round((top - contentY) / scale));
  const sw = Math.min(sourceWidth - sx, Math.max(1, Math.round((right - left) / scale)));
  const sh = Math.min(sourceHeight - sy, Math.max(1, Math.round((bottom - top) / scale)));
  return { sx, sy, sw, sh };
}

export function captureGuidedCardFrame(
  video: HTMLVideoElement,
  options: GuidedCaptureOptions,
): HTMLCanvasElement {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("The camera is not ready to capture.");
  }
  const viewport = options.viewportRect;
  const angle = options.angle;
  const viewZoom = options.viewZoom;
  if (
    !viewport
    || !finitePositive(viewport.width)
    || !finitePositive(viewport.height)
    || !finitePositive(options.guideRect.width)
    || !finitePositive(options.guideRect.height)
    || !Number.isFinite(angle)
    || !Number.isFinite(viewZoom)
    || viewZoom < 1
    || viewZoom > 2
  ) {
    throw new Error("The live camera guide is not ready.");
  }
  const left = Math.max(viewport.x, options.guideRect.x);
  const top = Math.max(viewport.y, options.guideRect.y);
  const right = Math.min(
    viewport.x + viewport.width,
    options.guideRect.x + options.guideRect.width,
  );
  const bottom = Math.min(
    viewport.y + viewport.height,
    options.guideRect.y + options.guideRect.height,
  );
  if (right <= left || bottom <= top) {
    throw new Error("Place the card guide inside the live camera image.");
  }

  const density = Math.min(
    video.videoWidth / viewport.width,
    video.videoHeight / viewport.height,
    MAX_EDGE / Math.max(viewport.width, viewport.height),
  );
  if (!finitePositive(density)) throw new Error("The live camera guide is not ready.");
  const stage = document.createElement("canvas");
  stage.width = Math.max(1, Math.round(viewport.width * density));
  stage.height = Math.max(1, Math.round(viewport.height * density));
  const stageContext = stage.getContext("2d");
  if (!stageContext) throw new Error("The captured photo could not be prepared.");
  const contentScale = Math.min(
    stage.width / video.videoWidth,
    stage.height / video.videoHeight,
  );
  const drawnWidth = video.videoWidth * contentScale;
  const drawnHeight = video.videoHeight * contentScale;
  stageContext.translate(stage.width / 2, stage.height / 2);
  stageContext.rotate(angle * Math.PI / 180);
  stageContext.scale(viewZoom, viewZoom);
  stageContext.drawImage(
    video,
    -drawnWidth / 2,
    -drawnHeight / 2,
    drawnWidth,
    drawnHeight,
  );

  const scaleX = stage.width / viewport.width;
  const scaleY = stage.height / viewport.height;
  const sx = Math.max(0, Math.round((left - viewport.x) * scaleX));
  const sy = Math.max(0, Math.round((top - viewport.y) * scaleY));
  const sw = Math.min(
    stage.width - sx,
    Math.max(1, Math.round((right - left) * scaleX)),
  );
  const sh = Math.min(
    stage.height - sy,
    Math.max(1, Math.round((bottom - top) * scaleY)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const outputContext = canvas.getContext("2d");
  if (!outputContext) throw new Error("The captured photo could not be prepared.");
  outputContext.drawImage(stage, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

export function preprocessOcrRegion(source: HTMLCanvasElement, region: OcrRegion) {
  const sx = Math.max(0, Math.round(source.width * region.x));
  const sy = Math.max(0, Math.round(source.height * region.y));
  const sw = Math.min(source.width - sx, Math.max(1, Math.round(source.width * region.width)));
  const sh = Math.min(source.height - sy, Math.max(1, Math.round(source.height * region.height)));
  const scale = Math.max(1, (region.minimumWidth ?? sw) / sw);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const drawContext = canvas.getContext("2d");
  if (!drawContext) throw new Error("The card text region could not be prepared.");
  drawContext.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const pixelContext = canvas.getContext("2d");
  if (!pixelContext) throw new Error("The card text region could not be prepared.");
  const image = pixelContext.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8ClampedArray(image.data.length / 4);
  let minimum = 255;
  let maximum = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    const value = Math.round(
      image.data[index] * 0.299
      + image.data[index + 1] * 0.587
      + image.data[index + 2] * 0.114,
    );
    gray[index / 4] = value;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const range = maximum - minimum;
  if (region.preprocessing === "adaptive") {
    const width = canvas.width;
    const height = canvas.height;
    const stride = width + 1;
    const integral = new Float64Array((width + 1) * (height + 1));
    for (let y = 1; y <= height; y += 1) {
      let row = 0;
      for (let x = 1; x <= width; x += 1) {
        row += gray[(y - 1) * width + x - 1];
        integral[y * stride + x] = integral[(y - 1) * stride + x] + row;
      }
    }
    const radius = Math.max(2, Math.round(Math.min(width, height) * 0.08));
    const offset = Math.max(6, Math.round(range * 0.04));
    for (let y = 0; y < height; y += 1) {
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height, y + radius + 1);
      for (let x = 0; x < width; x += 1) {
        const left = Math.max(0, x - radius);
        const right = Math.min(width, x + radius + 1);
        const total = integral[bottom * stride + right]
          - integral[top * stride + right]
          - integral[bottom * stride + left]
          + integral[top * stride + left];
        const average = total / ((right - left) * (bottom - top));
        const output = gray[y * width + x] >= average + offset ? 0 : 255;
        const pixel = (y * width + x) * 4;
        image.data[pixel] = output;
        image.data[pixel + 1] = output;
        image.data[pixel + 2] = output;
        image.data[pixel + 3] = 255;
      }
    }
    pixelContext.putImageData(image, 0, 0);
    return canvas;
  }
  for (let index = 0; index < image.data.length; index += 4) {
    const value = range > 0
      ? Math.round((gray[index / 4] - minimum) * 255 / range)
      : gray[index / 4];
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }
  pixelContext.putImageData(image, 0, 0);
  return canvas;
}

export async function startCardCamera(deviceId?: string): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access is not available in this browser.");
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: { ideal: "environment" } },
  });
}

function canvasFor(width: number, height: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  return canvas;
}

export function canvasPreviewUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("The captured photo could not be prepared."));
        return;
      }
      resolve(URL.createObjectURL(blob));
    }, "image/jpeg", 0.9);
  });
}

export function canvasUploadBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The captured photo could not be prepared for private recognition."));
    }, "image/jpeg", 0.9);
  });
}

export function captureCardFrame(video: HTMLVideoElement): HTMLCanvasElement {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("The camera is not ready to capture.");
  }
  const canvas = canvasFor(video.videoWidth, video.videoHeight);
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function prepareCardImage(file: File): Promise<HTMLCanvasElement> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Card photos must be 10 MB or smaller.");
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const canvas = canvasFor(bitmap.width, bitmap.height);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

export function stopCardCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
