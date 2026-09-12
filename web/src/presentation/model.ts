import { rewardFor, type RewardTier } from "./rewards";
import { apiRequest } from "../lib/api";
import type { CardSummary } from "../lib/types";
export type Settings = {
  reveal: "instant" | "fade" | "flip" | "slide" | "zoom" | "pop" | "tilt"; background: "transparent" | "green" | "blue" | "solid" | "gradient" | "spotlight" | "grid" | "stars";
  color: string; accent: string; layout: "landscape" | "portrait" | "square" | "reverse"; duration: number; hold: number;
  scale: number; glow: boolean; pack: boolean; details: boolean; prices: boolean;
  muted: boolean; volume: number; audio: "scanner" | "overlay";
  confirm: "off" | "chime" | "arcade"; reject: "off" | "chime" | "arcade"; complete: "off" | "chime" | "arcade";
  found?: "off" | "chime" | "arcade"; rewards?: boolean; particles?: boolean; reward_tiers?: RewardTier[];
  card_back?: string; highlights: boolean; enabled: boolean;
};
export type Pull = { preview_key?: string; id: string; name: string; printing_id: string; image: string; set: string; number: string;
  language: string; finish: string; price: string; rarity: string; quantity: number; highlight: boolean };
export type Presentation = { preview?: Pull | null; settings: Settings; cards: Pull[]; revision: number; finished: boolean;
  event: { id: string; kind: string } | null };
export const defaults: Settings = { reveal: "instant", background: "solid", color: "#121826", accent: "#a78bfa",
  layout: "landscape", duration: .7, hold: 3, scale: 1, glow: false, pack: false, details: true, prices: true,
  muted: false, volume: .35, audio: "scanner", confirm: "chime", reject: "chime", complete: "arcade", highlights: false, enabled: false };
export const endpoint = "/api/v1/presentation";
export function requestEvent(kind: string, extra: object = {}) {
  return apiRequest<Presentation>(endpoint + "/events", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), kind, ...extra }) });
}
export function pullDetails(card: CardSummary, finish: string, quantity: number): Pull {
  return { id: crypto.randomUUID(), name: card.name, printing_id: card.printing_id,
    image: card.image_uris.normal || card.image_uris.large || card.image_uris.small || "",
    set: card.set.name, number: card.collector_number, language: card.language, finish,
    price: (finish === "foil" ? card.prices.usd_foil : card.prices.usd) ? "$" + (finish === "foil" ? card.prices.usd_foil : card.prices.usd) : "Price unavailable",
    rarity: card.rarity, quantity, highlight: false };
}
export function savedPull(card: CardSummary, finish: string, quantity: number) {
  const pull = pullDetails(card,finish,quantity);
  window.dispatchEvent(new CustomEvent("cardvault-presentation", { detail: { id: pull.id, kind: "confirm", card: pull } }));
}
export function previewPull(card: CardSummary | undefined, finish: string, quantity: number, scanKey = "") {
  window.dispatchEvent(new CustomEvent("cardvault-selected-preview", { detail: card ? {...pullDetails(card,finish,quantity), preview_key:scanKey} : null }));
}
export function rejectedPull() { window.dispatchEvent(new CustomEvent("cardvault-presentation", { detail: { id: crypto.randomUUID(), kind: "reject" } })); }
export function recapCards(state: Presentation) {
  const chosen = state.settings.highlights ? state.cards.filter(c => c.highlight) : state.cards;
  return chosen.length ? chosen : state.cards;
}
export function backdrop(s: Settings) {
  if (s.background === "gradient") return `linear-gradient(135deg,${s.color},${s.accent}66),${s.color}`;
  if (s.background === "spotlight") return `radial-gradient(ellipse at center,${s.accent}55,transparent 70%),${s.color}`;
  if (s.background === "grid") return `linear-gradient(${s.accent}22 1px,transparent 1px) 0 0/32px 32px,linear-gradient(90deg,${s.accent}22 1px,transparent 1px) 0 0/32px 32px,${s.color}`;
  if (s.background === "stars") return `radial-gradient(${s.accent}66 1px,transparent 1px) 0 0/23px 23px,${s.color}`;
  return s.background === "transparent" ? "transparent" : s.background === "green" ? "#00ff00" : s.background === "blue" ? "#0000ff" : s.color; }
export function tone(context: AudioContext, s: Settings, kind: "confirm" | "reject" | "complete" | "found", destination?: AudioNode, card?: Pull) {
  if (s.muted || context.state !== "running") return;
  const reward = kind === "confirm" ? rewardFor(s,card) : undefined;
  const prize = reward && reward.sound !== "off" ? reward : undefined;
  if (!prize && s[kind] === "off") return;
  const freqs = prize ? [523,659,784,...(prize.threshold>=10?[1047]:[]),...(prize.threshold>=20?[1319]:[]),...(prize.threshold>=50?[1568]:[]),...(prize.threshold>=100?[2093]:[])] : kind === "found" ? [440,660] : kind === "reject" ? [220, 160] : kind === "complete" ? [523, 659, 784, 1047] : [659, 880];
  const notes = prize?.sound === "fanfare" ? [...freqs,...freqs.slice(-2).reverse()] : freqs;
  notes.forEach((frequency, i) => {
    const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = (prize?.sound ?? s[kind]) === "arcade" ? "triangle" : "sine"; oscillator.frequency.value = frequency;
    const start = context.currentTime + i * .12;
    gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(s.volume * .15, start + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, start + .22);
    oscillator.connect(gain); gain.connect(destination || context.destination); oscillator.start(start); oscillator.stop(start + .23);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  });
}
