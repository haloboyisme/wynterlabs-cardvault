import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { CatalogNotices } from "./CatalogNotices";

it("shows only the selected providers' attribution and Magic notice", () => {
  render(<CatalogNotices games={["pokemon", "yugioh"]} />);

  expect(screen.getByRole("link", { name: /Pokémon TCG API/i })).toBeVisible();
  expect(screen.getByRole("link", { name: /YGOPRODeck/i })).toBeVisible();
  expect(screen.queryByRole("link", { name: /Scryfall/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/Wizards Fan Content Policy/i)).not.toBeInTheDocument();
});
