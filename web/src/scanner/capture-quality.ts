const SAMPLE_WIDTH = 96;
const SAMPLE_HEIGHT = 128;

// Lightweight guidance only: never reject a scan based on these heuristics.
export function assessCapture(gray: number[]): string {
  if (!gray.length) return "";
  const mean = gray.reduce((sum, value) => sum + value, 0) / gray.length;
  const glare = gray.filter((value) => value >= 250).length / gray.length;
  if (mean < 45) {
    return "The photo looks dark. Add soft light from the side and keep the card steady.";
  }
  if (glare > 0.3) {
    return "Bright areas may hide card text. Tilt the card or move the light to reduce glare.";
  }
  let edges = 0;
  let count = 0;
  for (let i = 1; i < gray.length; i++) {
    if (i % SAMPLE_WIDTH) {
      edges += Math.abs(gray[i] - gray[i - 1]);
      count++;
    }
  }
  if (count && edges / count < 2) {
    return "The photo has little text detail. Hold still, check focus, and avoid too much digital zoom.";
  }
  return "";
}

export function captureQualityMessage(source: HTMLCanvasElement): string {
  try {
    const sample = document.createElement("canvas");
    sample.width = SAMPLE_WIDTH;
    sample.height = SAMPLE_HEIGHT;
    const ctx = sample.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(source, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const pixels = ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
    const gray: number[] = [];
    for (let i = 0; i < pixels.length; i += 4) {
      gray.push(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
    }
    return assessCapture(gray);
  } catch {
    return "";
  }
}
