interface CatalogNoticesProps {
  games: string[];
}

export function CatalogNotices({ games }: CatalogNoticesProps) {
  const shownGames = new Set(games);
  return (
    <aside className="catalog-notices" aria-label="Card data and fan content notices">
      {shownGames.has("mtg") && <>
        <p><a href="https://scryfall.com/" target="_blank" rel="noreferrer">Card data provided by Scryfall</a>. Catalog information and images may be delayed.</p>
        <p>WynterLabs CardVault is unofficial fan content permitted under the <a href="https://company.wizards.com/en/legal/fancontentpolicy" target="_blank" rel="noreferrer">Wizards Fan Content Policy</a>. It is not approved or endorsed by Wizards of the Coast.</p>
        <p>Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC.</p>
      </>}
      {shownGames.has("pokemon") && <p><a href="https://pokemontcg.io/" target="_blank" rel="noreferrer">Card data provided by Pokémon TCG API</a>. Catalog information and images may be delayed.</p>}
      {shownGames.has("yugioh") && <p><a href="https://ygoprodeck.com/api-guide/" target="_blank" rel="noreferrer">Card data provided by YGOPRODeck</a>. Catalog information and images may be delayed.</p>}
      {shownGames.size === 0 && <p>Catalog sources are shown for the selected game after matching cards load.</p>}
    </aside>
  );
}
