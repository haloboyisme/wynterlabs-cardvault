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
      url.hostname === "images.ygoprodeck.com"
    ) {
      return `/api/v1/catalog/media?source=${encodeURIComponent(value)}`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function CardImage({ name, imageUris, className }: CardImageProps) {
  const [failed, setFailed] = useState(false);
  const source = approvedCardImage(
    imageUris.normal ?? imageUris.large ?? imageUris.small,
  );
  useEffect(() => {
    setFailed(false);
  }, [source]);

  if (!source || failed) {
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
  return (
    <img
      className={className}
      src={source}
      alt={`${name} card`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
