import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CardImage } from "./CardImage";

it("recovers from an image error when the source changes", () => {
  const view = render(
    <CardImage
      name="First"
      imageUris={{ normal: "https://cards.scryfall.io/normal/first.jpg" }}
    />,
  );
  fireEvent.error(screen.getByRole("img", { name: "First card" }));
  expect(screen.getByRole("img", { name: /image unavailable for first/i })).toBeVisible();
  view.rerender(
    <CardImage
      name="Second"
      imageUris={{ normal: "https://cards.scryfall.io/normal/second.jpg" }}
    />,
  );
  expect(screen.getByRole("img", { name: "Second card" })).toHaveAttribute(
    "src",
    `/api/v1/catalog/media?source=${encodeURIComponent(
      "https://cards.scryfall.io/normal/second.jpg",
    )}`,
  );
});

it.each([
  "http://cards.scryfall.io/normal/card.jpg",
  "https://user:member-bb4d30eb7a73@example.invalid/normal/card.jpg",
  "https://cards.scryfall.io:444/normal/card.jpg",
  "https://192.0.2.151/internal.jpg",
  "javascript:alert(1)",
])("does not render an unsafe image source: %s", (source) => {
  render(<CardImage name="Unsafe" imageUris={{ normal: source }} />);
  expect(screen.getByRole("img", { name: /image unavailable for unsafe/i })).toBeVisible();
  expect(screen.queryByAltText("Unsafe card")).not.toBeInTheDocument();
});

it.each([
  "https://cards.scryfall.io/normal/front/a/b/card.jpg",
  "https://images.pokemontcg.io/base1/4_hires.png",
  "https://images.ygoprodeck.com/images/cards/89631139.jpg",
])("loads third-party catalog images through the local authenticated cache: %s", (source) => {
  render(<CardImage name="Cached" imageUris={{ normal: source }} />);
  const image = screen.getByRole("img", { name: "Cached card" });
  expect(image).toHaveAttribute(
    "src",
    `/api/v1/catalog/media?source=${encodeURIComponent(source)}`,
  );
});
