import { useEffect, useState } from "react";

interface CardImageProps {
  name: string;
  imageUris: Record<string, string>;
  className?: string;
}

function approvedCardImage(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) {
      return undefined;
    }
    if (
      url.hostname === "cards.scryfall.io" ||
      url.hostname === "images.pokemontcg.io" ||
      url.hostname === "images.ygoprodeck.com" ||
      url.hostname === "tcgplayer-cdn.tcgplayer.com" ||
      url.hostname === "images.digimoncard.io"
    ) {
      return `/api/v1/catalog/media?source=${encodeURIComponent(value)}`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function CardImage({ name, imageUris, className }: CardImageProps) {
  const sources = ["normal", "large", "small", "reference"]
    .map((kind) => ({ kind, source: approvedCardImage(imageUris[kind]) }))
    .filter((item): item is { kind: string; source: string } => Boolean(item.source))
    .filter((item, index, items) => (
      items.findIndex((candidate) => candidate.source === item.source) === index
    ));
  const sourceKey = sources.map((item) => `${item.kind}:${item.source}`).join("|");
  const [sourceIndex, setSourceIndex] = useState(0);
  useEffect(() => {
    setSourceIndex(0);
  }, [sourceKey]);
  const selected = sources[sourceIndex];

  if (!selected) {
    return (
      <div
        className={className}
        role="img"
        aria-label={`Image unavailable for ${name}`}
      >
        Image unavailable for {name}
      </div>
    );
  }
  const reference = selected.kind === "reference";
  return <>
    <img
      className={className}
      src={selected.source}
      alt={`${name} ${reference ? "reference artwork" : "card"}`}
      loading="lazy"
      onError={() => setSourceIndex((current) => current + 1)}
    />
    {reference ? (
      <span className="card-image-reference-note">
        Reference artwork — verify exact printing
      </span>
    ) : null}
  </>;
}
