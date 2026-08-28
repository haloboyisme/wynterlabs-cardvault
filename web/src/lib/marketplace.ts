export interface MarketplaceCard {
  game: string;
  name: string;
  setCode: string;
  collectorNumber: string;
}

export interface MarketplaceLink {
  label: string;
  href: string;
}

const TCGPLAYER_PRODUCT_LINES: Record<string, string> = {
  mtg: "magic",
  pokemon: "pokemon",
  yugioh: "yugioh",
};

export function marketplaceLinksForCard(card: MarketplaceCard): MarketplaceLink[] {
  const name = card.name.split(" // ", 1)[0].trim();
  const query = [name, card.setCode.toUpperCase(), card.collectorNumber].filter(Boolean).join(" ");
  const encodedQuery = new URLSearchParams({ q: query }).toString().slice(2);
  const links: MarketplaceLink[] = [];
  const productLine = TCGPLAYER_PRODUCT_LINES[card.game.trim().toLowerCase()];

  if (productLine) {
    links.push({
      label: "Search TCGplayer",
      href: `https://www.tcgplayer.com/search/${productLine}/product?productLineName=${productLine}&q=${encodedQuery}&view=grid`,
    });
  }
  links.push({
    label: "Search eBay",
    href: `https://www.ebay.com/sch/i.html?_nkw=${encodedQuery}`,
  });
  return links;
}
