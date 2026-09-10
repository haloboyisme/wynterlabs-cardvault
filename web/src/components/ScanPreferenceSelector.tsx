import type { CardSet } from "../lib/types";
import { CATALOG_GAMES, setSelectionValue, setsForGame } from "../scanner/catalog-games";

interface ScanPreferenceSelectorProps {
  restoreSetOnGameChange?: boolean;
  sets: CardSet[];
  preferredGame: string;
  preferredSet: string;
  onPreferredGameChange: (game: string) => void;
  onPreferredSetChange: (setValue: string) => void;
}

export function ScanPreferenceSelector({
  restoreSetOnGameChange = false,
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
    if (!restoreSetOnGameChange && !selectedSetIsAvailable) onPreferredSetChange("");
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
    <small>Prioritizes likely matches while keeping other sets available for correction. Your last game and set are remembered for this account on this browser. Choose Auto — all sets to clear the set.</small>
    <details className="scanner-reading-help">
      <summary>Split, sideways, foil or promo card?</summary>
      <p>For Room or split cards, search either printed half-title. Rotate the camera view until the title is upright, or retake from the other direction.</p>
      <p>For foil glare, tilt the card slightly or move the light so both the title and bottom collector number are clear. Keep the whole card in the frame.</p>
      <p>Promo and alternate-art cards can share a name. Compare the artwork, set, collector number and language; choose foil/nonfoil and condition yourself before confirming.</p>
      <p>For long sessions, confirm and add reviewed cards in smaller batches to free preview memory. Unconfirmed photos stay only in this tab.</p>
    </details>
  </div>;
}
