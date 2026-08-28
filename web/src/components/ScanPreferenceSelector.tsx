import type { CardSet } from "../lib/types";
import { CATALOG_GAMES, setSelectionValue, setsForGame } from "../scanner/catalog-games";

interface ScanPreferenceSelectorProps {
  sets: CardSet[];
  preferredGame: string;
  preferredSet: string;
  onPreferredGameChange: (game: string) => void;
  onPreferredSetChange: (setValue: string) => void;
}

export function ScanPreferenceSelector({
  sets,
  preferredGame,
  preferredSet,
  onPreferredGameChange,
  onPreferredSetChange,
}: ScanPreferenceSelectorProps) {
  const availableSets = setsForGame(sets, preferredGame);
  const availableSetsFor = (game: string) => setsForGame(sets, game);

  const selectGame = (game: string) => {
    const selectedSetIsAvailable = !preferredSet || availableSetsFor(game)
      .some((set) => setSelectionValue(set) === preferredSet);
    onPreferredGameChange(game);
    if (!selectedSetIsAvailable) onPreferredSetChange("");
  };

  return <div className="scanner-set-preference">
    <div className="scan-preference-field">
      <label htmlFor="scanner-preferred-game">Game or brand</label>
      <select
        id="scanner-preferred-game"
        value={preferredGame}
        onChange={(event) => selectGame(event.target.value)}
      >
        <option value="">Auto — all supported games</option>
        {CATALOG_GAMES.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
      </select>
    </div>
    <div className="scan-preference-field">
      <label htmlFor="scanner-preferred-set">Preferred set</label>
      <select
        id="scanner-preferred-set"
        value={preferredSet}
        onChange={(event) => onPreferredSetChange(event.target.value)}
      >
        <option value="">Auto — all sets</option>
        {availableSets.map((set) => <option key={set.id} value={setSelectionValue(set)}>
          {set.name} ({set.code.toUpperCase()})
        </option>)}
      </select>
    </div>
    <small>Prioritizes likely matches from this set while keeping other sets available for correction.</small>
  </div>;
}
