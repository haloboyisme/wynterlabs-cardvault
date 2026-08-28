import type { ScanCandidate } from "../lib/types";

const normalizedCollector = (value: string) => value
  .trim()
  .toLocaleLowerCase()
  .split("/", 1)[0]
  .trim()
  .replace(/^0+(?=\d)/, "");

const normalizedSet = (value?: string) => value?.trim().toLocaleLowerCase() ?? "";
const normalizedTitle = (value?: string) => value?.trim().toLocaleLowerCase() ?? "";

export function rankScanCandidates(
  candidates: ScanCandidate[],
  hints: { set?: string; collector?: string },
  preferredSet?: string,
  preferredGame?: string,
) {
  const hintSet = normalizedSet(hints.set);
  const hintCollector = hints.collector ? normalizedCollector(hints.collector) : "";
  const preference = normalizedSet(preferredSet);
  const preferredGameKey = normalizedSet(preferredGame);
  return candidates
    .map((candidate, index) => {
      const candidateSet = normalizedSet(candidate.set.code);
      const exactPrinting = Boolean(
        hintSet
        && hintCollector
        && candidateSet === hintSet
        && normalizedCollector(candidate.collector_number) === hintCollector,
      );
      const preferred = Boolean(
        preference
        && candidateSet === preference
        && (!preferredGameKey || normalizedSet(candidate.set.game) === preferredGameKey),
      );
      return { candidate, index, rank: exactPrinting ? 0 : preferred ? 1 : 2 };
    })
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ candidate }) => candidate);
}

export function uniqueDetectedPrintingId(
  candidates: ScanCandidate[],
  hints: { name?: string; set?: string; collector?: string },
  preferredSet?: string,
  preferredGame?: string,
) {
  const ranked = rankScanCandidates(candidates, hints, preferredSet, preferredGame);
  if (ranked.length === 0) return "";
  const title = normalizedTitle(hints.name);
  if (ranked.length === 1) {
    return !title || normalizedTitle(ranked[0].name) === title
      ? ranked[0].printing_id
      : "";
  }
  const collector = hints.collector ? normalizedCollector(hints.collector) : "";
  const setCode = normalizedSet(hints.set);
  if (!title || !setCode || !collector) return "";
  const exactMatches = ranked.filter((candidate) =>
    normalizedTitle(candidate.name) === title
    && normalizedSet(candidate.set.code) === setCode
    && normalizedCollector(candidate.collector_number) === collector,
  );
  return exactMatches.length === 1 ? exactMatches[0].printing_id : "";
}
