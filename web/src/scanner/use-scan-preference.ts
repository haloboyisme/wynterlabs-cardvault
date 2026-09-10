import { useState } from "react";
import type { CardSet } from "../lib/types";
import { CATALOG_GAMES, setSelectionValue, setsForGame } from "./catalog-games";

type Preference = { game: string; sets: Record<string, string> };
const empty = (): Preference => ({ game: "", sets: {} });
const key = (owner: string) => `cardvault.scan-preference.v1:${owner}`;
function read(owner: string): Preference {
  if (!owner) return empty();
  try {
    const value = JSON.parse(localStorage.getItem(key(owner)) || "null");
    if (!value || typeof value !== "object") return empty();
    const game = CATALOG_GAMES.some(g => g.id === value.game) ? value.game : "";
    const sets: Record<string, string> = {};
    for (const name of ["", ...CATALOG_GAMES.map(g => g.id)]) {
      if (typeof value.sets?.[name] === "string") sets[name] = value.sets[name];
    }
    return {game, sets};
  } catch { return empty(); }
}
export function useScanPreference(owner: string, catalogSets: CardSet[]) {
  const [state, setState] = useState(() => ({owner, value: read(owner)}));
  const value = state.owner === owner ? state.value : read(owner);
  const save = (next: Preference) => {
    setState({owner, value: next});
    if (owner) { try { localStorage.setItem(key(owner), JSON.stringify(next)); } catch { /* Keep working when storage is blocked. */ } }
  };
  const preferredGame = value.game;
  const savedSet = value.sets[preferredGame] || "";
  const preferredSet = setsForGame(catalogSets, preferredGame).some(set => setSelectionValue(set) === savedSet) ? savedSet : "";
  return {
    preferredGame, preferredSet,
    setPreferredGame: (game: string) => save({...value, game}),
    setPreferredSet: (set: string) => {
      const selectedGame = set.split(":")[0];
      const byGame = !preferredGame && set && CATALOG_GAMES.some(g => g.id === selectedGame)
        ? {[selectedGame]: set} : {};
      save({...value, sets: {...value.sets, ...byGame, [preferredGame]: set}});
    },
  };
}
