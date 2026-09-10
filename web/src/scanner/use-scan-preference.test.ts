import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import type { CardSet } from "../lib/types";
import { useScanPreference } from "./use-scan-preference";
const sets = [{id:"1",game:"mtg",code:"fdn"},{id:"2",game:"pokemon",code:"base"}] as CardSet[];
beforeEach(() => localStorage.clear());
it("restores after navigation and isolates games and accounts", () => {
  const view = renderHook(({owner}) => useScanPreference(owner, sets), {initialProps:{owner:"a"}});
  act(() => view.result.current.setPreferredGame("mtg"));
  act(() => view.result.current.setPreferredSet("mtg:fdn"));
  act(() => view.result.current.setPreferredGame("pokemon"));
  expect(view.result.current.preferredSet).toBe("");
  act(() => view.result.current.setPreferredSet("pokemon:base"));
  act(() => view.result.current.setPreferredGame("mtg"));
  expect(view.result.current.preferredSet).toBe("mtg:fdn");
  view.rerender({owner:"b"});
  expect(view.result.current.preferredGame).toBe("");
  expect(view.result.current.preferredSet).toBe("");
  view.unmount();
  const returned = renderHook(() => useScanPreference("a", sets));
  expect(returned.result.current.preferredSet).toBe("mtg:fdn");
  act(() => returned.result.current.setPreferredSet(""));
  returned.unmount();
  expect(renderHook(() => useScanPreference("a", sets)).result.current.preferredSet).toBe("");
});
it("waits for catalog loading and falls back for removed sets", () => {
  localStorage.setItem("cardvault.scan-preference.v1:a", JSON.stringify({game:"mtg",sets:{mtg:"mtg:fdn"}}));
  const view = renderHook(({catalog}) => useScanPreference("a", catalog), {initialProps:{catalog:[] as CardSet[]}});
  expect(view.result.current.preferredSet).toBe("");
  view.rerender({catalog:sets});
  expect(view.result.current.preferredSet).toBe("mtg:fdn");
  view.rerender({catalog:sets.slice(1)});
  expect(view.result.current.preferredSet).toBe("");
});
it("ignores corrupt stored settings", () => {
  localStorage.setItem("cardvault.scan-preference.v1:a", "broken");
  expect(renderHook(() => useScanPreference("a", sets)).result.current.preferredSet).toBe("");
});
