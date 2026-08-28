import { createWorker, OEM, PSM } from "tesseract.js";

import { preprocessOcrRegion } from "./capture";

export interface OcrHints {
  name: string;
  titleCandidates: string[];
  set?: string;
  collector?: string;
  rawText: string;
}

export interface CardOcrWorker {
  recognize(image: CanvasImageSource): Promise<OcrHints>;
  terminate(): Promise<void>;
}

const TITLE_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ,.'!?:&/-";

const TITLE_REGIONS = [
  { x: 0.04, y: 0, width: 0.92, height: 0.3, minimumWidth: 1400, preprocessing: "adaptive" },
  { x: 0.04, y: 0.05, width: 0.92, height: 0.3, minimumWidth: 1400, preprocessing: "adaptive" },
  { x: 0.04, y: 0.1, width: 0.92, height: 0.3, minimumWidth: 1400, preprocessing: "adaptive" },
  { x: 0.04, y: 0.15, width: 0.92, height: 0.3, minimumWidth: 1400, preprocessing: "adaptive" },
] as const;

const RULES_TEXT = /\b(?:whenever|when|target|draw|discard|counter|control|attacks?|blocks?|cast|damage|destroy|exile|gets?|put|return|sacrifice|until)\b/gi;
const CARD_TYPE = /\b(?:artifact|battle|creature|enchantment|instant|land|planeswalker|sorcery)\b/i;

function titleShapeScore(value: string) {
  const letters = value.match(/[A-Za-z]/g)?.length ?? 0;
  const words = value.split(/\s+/).filter(Boolean).length;
  const punctuationBonus = /[,:'-]/.test(value) ? 2 : 0;
  const lengthPenalty = Math.max(0, value.length - 60);
  return letters + Math.min(words, 6) * 5 + punctuationBonus - lengthPenalty;
}

function looksLikeRulesOrTypeLine(value: string) {
  const tokens = value.split(/\s+/).filter(Boolean);
  if (/[+=]|\d+\s*\/\s*\d+/.test(value)) return true;
  const rulesWords = value.match(RULES_TEXT)?.length ?? 0;
  if (tokens.length >= 4 && rulesWords >= 2) return true;
  return (
    CARD_TYPE.test(value)
    && (/^(?:basic|legendary|snow|world)\b/i.test(value) || /[—–]\s*/.test(value))
  );
}

function textLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

function cleanTitleLine(value: string) {
  return value
    .trim()
    .replace(/^[|\[\]{}<>_=~*]+/, "")
    .replace(/[|\[\]{}<>_=~*]+$/, "")
    .trim();
}

function plausibleTitle(value: string) {
  const letters = value.match(/[A-Za-z]/g)?.length ?? 0;
  if (letters < 3 || value.length < 3 || value.length > 200) return false;
  if (/[\\|]/.test(value)) return false;
  const tokens = value
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean);
  const singleLetterTokens = tokens.filter((token) => token.length === 1).length;
  if (tokens.length >= 3 && singleLetterTokens / tokens.length > 0.5) return false;
  const visible = value.replace(/\s/g, "");
  const alphanumeric = value.match(/[A-Za-z0-9]/g)?.length ?? 0;
  if (visible.length && alphanumeric / visible.length < 0.65) return false;
  if (looksLikeRulesOrTypeLine(value)) return false;
  const detail = value.match(/^\s*([A-Z0-9]{2,8})\s+([A-Z0-9-]{1,16})\s*$/);
  return !(detail && /\d/.test(detail[2]));
}

function bestTitle(value: string) {
  return textLines(value)
    .map(cleanTitleLine)
    .filter(plausibleTitle)
    .sort((left, right) => right.length - left.length)[0] ?? "";
}

function rankedTitleLines(value: string) {
  const lines = textLines(value)
    .map(cleanTitleLine)
    .filter(plausibleTitle);
  const primary = lines
    .map((line, index) => ({ line, index, score: titleShapeScore(line) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.line;
  return primary ? [primary, ...lines.filter((line) => line !== primary)] : [];
}

function titleCandidates(titleText: string, fallbackText: string) {
  const seen = new Set<string>();
  return [...rankedTitleLines(titleText), ...rankedTitleLines(fallbackText)]
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

const LANGUAGE_CODES = new Set([
  "en", "es", "fr", "de", "it", "pt", "ja", "ko", "ru", "zhs", "zht",
]);

function printingHints(value: string) {
  const tokens = value.match(/[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*/g) ?? [];
  const isCollector = (token: string) => (
    /\d/.test(token)
    && /^[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*$/.test(token)
  );
  const isSet = (token: string) => (
    /[A-Za-z]/.test(token)
    && /^[A-Za-z0-9]{2,8}$/.test(token)
    && !LANGUAGE_CODES.has(token.toLowerCase())
  );
  let fallbackCollector = "";
  for (const [index, collector] of tokens.entries()) {
    if (!isCollector(collector)) continue;
    fallbackCollector ||= collector;
    const set = tokens.slice(index + 1).find(isSet)
      ?? tokens.slice(0, index).reverse().find(isSet);
    if (set) return { set: set.toLowerCase(), collector };
  }
  return fallbackCollector ? { collector: fallbackCollector } : {};
}

function hintsFromPasses(titleText: string, collectorText: string, fallbackText = ""): OcrHints {
  const rawText = [titleText, collectorText, fallbackText]
    .flatMap(textLines)
    .join("\n")
    .slice(0, 2000);
  const candidates = titleCandidates(titleText, fallbackText);
  const name = candidates[0] ?? "";
  const detail = printingHints(collectorText);
  return {
    name: name.slice(0, 200),
    titleCandidates: candidates,
    ...detail,
    rawText,
  };
}

export async function createCardOcrWorker(
  progress: (value: number, status: string) => void,
): Promise<CardOcrWorker> {
  let activePass = 0;
  const passCount = TITLE_REGIONS.length + 2;
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/tesseract-core-simd-lstm.wasm.js",
    langPath: "/ocr",
    gzip: true,
    logger: (message) => {
      const passProgress = Math.min(1, Math.max(0, message.progress || 0));
      progress(Math.min(1, (activePass + passProgress) / passCount), message.status);
    },
  });
  let terminated = false;
  return {
    async recognize(image) {
      const card = image as HTMLCanvasElement;
      const titleTexts: string[] = [];
      for (const [index, region] of TITLE_REGIONS.entries()) {
        activePass = index;
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          tessedit_char_whitelist: TITLE_CHARACTERS,
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        });
        const title = preprocessOcrRegion(card, region);
        const result = await worker.recognize(title);
        titleTexts.push(result.data.text);
      }
      const titleText = titleTexts.join("\n");
      const collector = preprocessOcrRegion(card, {
        x: 0.02,
        y: 0.8,
        width: 0.72,
        height: 0.2,
        minimumWidth: 1400,
      });
      activePass = TITLE_REGIONS.length;
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/ ",
      });
      const collectorResult = await worker.recognize(collector);
      let fallbackText = "";
      if (!bestTitle(titleText)) {
        activePass = TITLE_REGIONS.length + 1;
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          tessedit_char_whitelist: "",
        });
        const fallback = await worker.recognize(card);
        fallbackText = fallback.data.text;
      }
      progress(1, "card text ready");
      return hintsFromPasses(titleText, collectorResult.data.text, fallbackText);
    },
    async terminate() {
      if (terminated) return;
      terminated = true;
      await worker.terminate();
    },
  };
}
