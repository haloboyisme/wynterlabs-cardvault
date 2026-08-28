import { useState } from "react";
import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CardSet } from "../lib/types";
import { ScanPreferenceSelector } from "./ScanPreferenceSelector";

const magicSet: CardSet = {
  id: "lea",
  code: "lea",
  name: "Limited Edition Alpha",
  set_type: "core",
  released_at: "1993-08-05",
  card_count: 295,
  digital: false,
  icon_svg_uri: null,
    game: 'mtg',};

const futurePokemonSet: CardSet = {
  ...magicSet,
  id: "base1",
  code: "base1",
  name: "Pokemon Base Set",
  game: "pokemon",
};

function PreferenceHarness({ initialSet = "" }: { initialSet?: string }) {
  const [preferredGame, setPreferredGame] = useState("");
  const [preferredSet, setPreferredSet] = useState(initialSet);
  return <ScanPreferenceSelector
    sets={[magicSet, futurePokemonSet]}
    preferredGame={preferredGame}
    preferredSet={preferredSet}
    onPreferredGameChange={setPreferredGame}
    onPreferredSetChange={setPreferredSet}
  />;
}

it("shows every supported game from the shared registry", () => {
  render(<PreferenceHarness />);

  expect(screen.getByRole("combobox", { name: "Game or brand" })).toHaveValue("");
  expect(screen.getByRole("option", { name: "Auto — all supported games" })).toBeVisible();
  expect(screen.getByRole("option", { name: "Magic: The Gathering" })).toBeVisible();
  expect(screen.getByRole("option", { name: "Pokémon" })).toBeVisible();
  expect(screen.getByRole("option", { name: "Yu-Gi-Oh!" })).toBeVisible();
  expect(screen.getAllByRole("option")).toHaveLength(7);
});

it("filters set options to the selected game", async () => {
  const user = userEvent.setup();
  render(<PreferenceHarness />);

  const game = screen.getByRole("combobox", { name: "Game or brand" });
  const set = screen.getByRole("combobox", { name: "Preferred set" });
  expect(screen.getByRole("option", { name: "Pokemon Base Set (BASE1)" })).toBeVisible();

  await user.selectOptions(game, "mtg");

  expect(set).toHaveValue("");
  expect(screen.getByRole("option", { name: "Limited Edition Alpha (LEA)" })).toBeVisible();
  expect(screen.queryByRole("option", { name: "Pokemon Base Set (BASE1)" })).not.toBeInTheDocument();
});

it("clears an incompatible preferred set when the game changes", async () => {
  const user = userEvent.setup();
  render(<PreferenceHarness initialSet="pokemon:base1" />);

  expect(screen.getByRole("combobox", { name: "Preferred set" })).toHaveValue("pokemon:base1");
  await user.selectOptions(screen.getByRole("combobox", { name: "Game or brand" }), "mtg");

  expect(screen.getByRole("combobox", { name: "Preferred set" })).toHaveValue("");
});
