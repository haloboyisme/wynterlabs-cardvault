import { apiRequest } from "./api";
import type {
  Deck, DeckCard, DeckDetail, DeckFormat, DeckInput, DeckPage, DeckSection,
} from "./types";

const API = "/api/v1/decks";

export const DECK_FORMATS: DeckFormat[] = [
  "standard", "future", "historic", "timeless", "gladiator", "pioneer",
  "explorer", "modern", "legacy", "pauper", "vintage", "penny",
  "commander", "oathbreaker", "standardbrawl", "brawl", "alchemy",
  "paupercommander", "duel", "oldschool", "premodern", "predh",
];

const GAME_FORMATS: Record<string, DeckFormat[]> = {
  pokemon: ["standard", "expanded", "unlimited"],
  yugioh: ["advanced", "traditional", "unlimited"],
};

export function formatsForGame(game: string): DeckFormat[] {
  return GAME_FORMATS[game] ?? DECK_FORMATS;
}

const NORMAL_SECTIONS: DeckSection[] = [
  "mainboard", "sideboard", "companion", "maybeboard",
];
const COMMANDER_FORMATS = new Set<DeckFormat>([
  "commander", "brawl", "standardbrawl", "paupercommander", "duel",
]);

export function sectionsForFormat(format: DeckFormat): DeckSection[] {
  if (format === "oathbreaker") {
    return ["oathbreaker", "signature_spell", ...NORMAL_SECTIONS];
  }
  if (COMMANDER_FORMATS.has(format)) return ["commander", ...NORMAL_SECTIONS];
  return NORMAL_SECTIONS;
}

export const listDecks = (signal?: AbortSignal) =>
  apiRequest<DeckPage>(API, { signal });

export const createDeck = (payload: DeckInput, signal?: AbortSignal) =>
  apiRequest<Deck>(API, { method: "POST", body: JSON.stringify(payload), signal });

export const getDeck = (deckId: string, signal?: AbortSignal) =>
  apiRequest<DeckDetail>(`${API}/${encodeURIComponent(deckId)}`, { signal });

export const updateDeck = (
  deckId: string,
  payload: DeckInput & { expected_revision: number },
  signal?: AbortSignal,
) => apiRequest<Deck>(`${API}/${encodeURIComponent(deckId)}`, {
  method: "PATCH", body: JSON.stringify(payload), signal,
});

export const deleteDeck = (
  deckId: string, expectedRevision: number, signal?: AbortSignal,
) => apiRequest<void>(
  `${API}/${encodeURIComponent(deckId)}?expected_revision=${expectedRevision}`,
  { method: "DELETE", signal },
);

export const setDeckCard = (
  deckId: string,
  payload: {
    printing_id: string;
    section: DeckSection;
    quantity: number;
    expected_revision?: number;
  },
  signal?: AbortSignal,
) => apiRequest<DeckDetail>(`${API}/${encodeURIComponent(deckId)}/cards`, {
  method: "PUT", body: JSON.stringify(payload), signal,
});

export const updateDeckCard = (
  deckId: string,
  cardId: string,
  payload: { section: DeckSection; quantity: number; expected_revision: number },
  signal?: AbortSignal,
) => apiRequest<DeckDetail>(
  `${API}/${encodeURIComponent(deckId)}/cards/${encodeURIComponent(cardId)}`,
  { method: "PATCH", body: JSON.stringify(payload), signal },
);

export const removeDeckCard = (
  deckId: string, card: Pick<DeckCard, "id" | "revision">, signal?: AbortSignal,
) => apiRequest<void>(
  `${API}/${encodeURIComponent(deckId)}/cards/${encodeURIComponent(card.id)}?expected_revision=${card.revision}`,
  { method: "DELETE", signal },
);
