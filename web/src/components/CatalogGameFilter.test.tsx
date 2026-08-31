import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { CatalogGameFilter } from "./CatalogGameFilter";
import { CATALOG_GAMES } from "../scanner/catalog-games";

it("labels the native game filter and emits the selected catalog game", () => {
  const onChange = vi.fn();
  render(<CatalogGameFilter value="" onChange={onChange} idPrefix="cards" />);

  const select = screen.getByRole("combobox", { name: "Game or brand" });
  expect(Array.from(select.querySelectorAll("option"), (option) => [option.value, option.textContent]))
    .toEqual([
      ["", "Auto — all supported games"],
      ...CATALOG_GAMES.map((game) => [game.id, game.name]),
    ]);

  fireEvent.change(select, { target: { value: "mtg" } });
  expect(onChange).toHaveBeenCalledWith("mtg");
});

it("uses the supplied prefix to keep multiple game filter IDs unique", () => {
  render(<>
    <CatalogGameFilter value="" onChange={() => undefined} idPrefix="cards" />
    <CatalogGameFilter value="" onChange={() => undefined} idPrefix="collection" />
  </>);

  const selects = screen.getAllByRole("combobox", { name: "Game or brand" });
  expect(selects.map((select) => select.id)).toEqual(["cards-game-filter", "collection-game-filter"]);
  expect(new Set(selects.map((select) => select.id)).size).toBe(2);
});
