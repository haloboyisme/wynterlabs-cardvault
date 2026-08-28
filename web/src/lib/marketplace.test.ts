import { expect, it } from "vitest";

import { marketplaceLinksForCard } from "./marketplace";

it("builds external searches for the exact Magic printing", () => {
  expect(marketplaceLinksForCard({
    game: "mtg",
    name: "Arlinn, the Pack's Hope // Arlinn, the Moon's Fury",
    setCode: "MID",
    collectorNumber: "211",
  })).toEqual([
    {
      label: "Search TCGplayer",
      href: "https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=Arlinn%2C+the+Pack%27s+Hope+MID+211&view=grid",
    },
    {
      label: "Search eBay",
      href: "https://www.ebay.com/sch/i.html?_nkw=Arlinn%2C+the+Pack%27s+Hope+MID+211",
    },
  ]);
});

it("uses each supported TCGplayer product line while preserving an eBay fallback", () => {
  expect(marketplaceLinksForCard({ game: "pokemon", name: "Pikachu", setCode: "BASE", collectorNumber: "58" })[0].href)
    .toBe("https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=Pikachu+BASE+58&view=grid");
  expect(marketplaceLinksForCard({ game: "yugioh", name: "Dark Magician", setCode: "LOB", collectorNumber: "005" })[0].href)
    .toBe("https://www.tcgplayer.com/search/yugioh/product?productLineName=yugioh&q=Dark+Magician+LOB+005&view=grid");
  expect(marketplaceLinksForCard({ game: "future-game", name: "Future Card", setCode: "FUT", collectorNumber: "1" }))
    .toEqual([{
      label: "Search eBay",
      href: "https://www.ebay.com/sch/i.html?_nkw=Future+Card+FUT+1",
    }]);
});
