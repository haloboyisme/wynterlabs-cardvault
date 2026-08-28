export const CAPTURE_SHORTCUT_STORAGE_KEY = "wynterlabs.cards.capture-shortcut.v1";
export const DEFAULT_CAPTURE_SHORTCUT = "Space";

const ALLOWED_SHORTCUT = /^(Space|Enter|Key[A-Z]|Digit[0-9]|Numpad[0-9]|F(?:[1-9]|1[0-2])|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)$/;

export function validCaptureShortcut(code: string): boolean {
  return ALLOWED_SHORTCUT.test(code);
}

export function readCaptureShortcut(): string {
  try {
    const saved = localStorage.getItem(CAPTURE_SHORTCUT_STORAGE_KEY) ?? "";
    return validCaptureShortcut(saved) ? saved : DEFAULT_CAPTURE_SHORTCUT;
  } catch {
    return DEFAULT_CAPTURE_SHORTCUT;
  }
}

export function writeCaptureShortcut(code: string): boolean {
  if (!validCaptureShortcut(code)) return false;
  try {
    localStorage.setItem(CAPTURE_SHORTCUT_STORAGE_KEY, code);
    return true;
  } catch {
    return false;
  }
}

export function resetCaptureShortcut(): string {
  try {
    localStorage.removeItem(CAPTURE_SHORTCUT_STORAGE_KEY);
  } catch {
    // The default still applies when browser storage is unavailable.
  }
  return DEFAULT_CAPTURE_SHORTCUT;
}

export function captureShortcutLabel(code: string): string {
  if (code === "Space") return "Space";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Numpad ${code.slice(6)}`;
  const labels: Record<string, string> = {
    Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
    Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
  };
  return labels[code] ?? code;
}

export function shouldCaptureFromKeyboard(event: KeyboardEvent, shortcut: string): boolean {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  if (event.code !== shortcut) return false;
  const target = event.target;
  return !(target instanceof Element
    && target.closest("input, textarea, select, button, a, [contenteditable='true']"));
}
