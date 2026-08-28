import { CATALOG_GAMES } from "../scanner/catalog-games";

interface CatalogGameFilterProps {
  value: string;
  onChange(value: string): void;
  idPrefix?: string;
}

export function CatalogGameFilter({
  value,
  onChange,
  idPrefix = "catalog",
}: CatalogGameFilterProps) {
  const id = `${idPrefix}-game-filter`;

  return <label className="catalog-game-filter" htmlFor={id}>
    Game or brand
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Auto — all supported games</option>
      {CATALOG_GAMES.map((game) => <option key={game.id} value={game.id}>
        {game.name}
      </option>)}
    </select>
  </label>;
}
