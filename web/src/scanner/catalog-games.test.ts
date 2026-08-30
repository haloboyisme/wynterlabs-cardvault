import { expect, it } from "vitest";

import type { CardSet } from "../lib/types";
import { CATALOG_GAMES, catalogGameName, gameForSet, setsForGame } from "./catalog-games";

const magicSet: CardSet = {
  id: "lea",
  code: "lea",
  name: "Limited Edition Alpha",
  set_type: "core",
  released_at: "1993-08-05",
  card_count: 295,
  digital: false,
  icon_svg_uri: null,
  game: "mtg",
};

const futurePokemonSet: CardSet = {
  ...magicSet,
  id: "base1",
  code: "base1",
  name: "Pokemon Base Set",
  game: "pokemon",
};
const { game: _game, ...legacyMagicSet } = magicSet;


it("defaults legacy sets without game metadata to Magic: The Gathering", () => {
  expect(CATALOG_GAMES).toEqual([
    { id: "mtg", name: "Magic: The Gathering" },
    { id: "pokemon", name: "Pokémon" },
    { id: "yugioh", name: "Yu-Gi-Oh!" },
    { id: "onepiece", name: "One Piece Card Game" },
  ]);
  expect(gameForSet(magicSet)).toBe("mtg");
  expect(gameForSet({ ...magicSet, game: " " })).toBe("mtg");
  expect(gameForSet(futurePokemonSet)).toBe("pokemon");
  expect(gameForSet(legacyMagicSet as CardSet)).toBe("mtg");
});

it("keeps every set in Auto and filters a selected game by membership", () => {
  const sets = [magicSet, futurePokemonSet];

  expect(setsForGame(sets, "")).toEqual(sets);
  expect(setsForGame(sets, "mtg")).toEqual([magicSet]);
  expect(setsForGame(sets, "pokemon")).toEqual([futurePokemonSet]);
});

it("uses the shared Magic label and keeps unknown game labels readable", () => {
  expect(catalogGameName(" mtg ")).toBe("Magic: The Gathering");
  expect(catalogGameName("pokemon")).toBe("Pokémon");
  expect(catalogGameName("yugioh")).toBe("Yu-Gi-Oh!");
  expect(catalogGameName("onepiece")).toBe("One Piece Card Game");
  expect(catalogGameName("pokemon-tcg")).toBe("pokemon-tcg");
  expect(catalogGameName(" ")).not.toBe("Magic: The Gathering");
});
