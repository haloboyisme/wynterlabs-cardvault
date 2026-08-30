import type { CardSet } from "../lib/types";

export const CATALOG_GAMES = [
  { id: "mtg", name: "Magic: The Gathering" },
  { id: "pokemon", name: "Pokémon" },
  { id: "yugioh", name: "Yu-Gi-Oh!" },
  { id: "onepiece", name: "One Piece Card Game" },
  { id: "digimon", name: "Digimon Card Game" },
  { id: "starwars", name: "Star Wars: Unlimited" },
  { id: "unionarena", name: "Union Arena" },
  { id: "lorcana", name: "Disney Lorcana" },
  { id: "riftbound", name: "Riftbound" },
] as const;

function normalizeCatalogGame(game: string): string {
  return game.trim().toLocaleLowerCase();
}

export function catalogGameName(game: string): string {
  const normalizedGame = normalizeCatalogGame(game);
  return CATALOG_GAMES.find(({ id }) => id === normalizedGame)?.name ?? (normalizedGame || "Unknown game");
}

export function gameForSet(set: CardSet): string {
  return normalizeCatalogGame(set.game || "") || "mtg";
}

export function setsForGame(sets: CardSet[], game: string): CardSet[] {
  const selectedGame = normalizeCatalogGame(game);
  return selectedGame ? sets.filter((set) => gameForSet(set) === selectedGame) : sets;
}

export function setSelectionValue(set: CardSet): string {
  return `${gameForSet(set)}:${set.code.trim().toLocaleLowerCase()}`;
}

export function selectedSetFromValue(sets: CardSet[], value: string): CardSet | undefined {
  return sets.find((set) => setSelectionValue(set) === value);
}
