import type { ScanCandidate } from "../lib/types";

const normalizedCollector = (value: string) => value
  .trim()
  .toLocaleLowerCase()
  .split("/", 1)[0]
  .trim()
  .replace(/^0+(?=\d)/, "");

const normalizedSet = (value?: string) => value?.trim().toLocaleLowerCase() ?? "";
const normalizedTitle = (value?: string) => value
  ?.normalize("NFKD")
  .toLocaleLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ") ?? "";

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
  const titleMatches = title
    ? ranked.filter((candidate) => {
        const candidateTitle = normalizedTitle(candidate.name);
        return candidateTitle === title || candidateTitle.startsWith(`${title} `);
      })
    : ranked;
  if (title && titleMatches.length === 0) return "";
  if (titleMatches.length === 1) return titleMatches[0].printing_id;
  if (!title) return ranked.length === 1 ? ranked[0].printing_id : "";

  const collector = hints.collector ? normalizedCollector(hints.collector) : "";
  const setCode = normalizedSet(hints.set);
  const exactMatches = titleMatches.filter((candidate) =>
    (!setCode || normalizedSet(candidate.set.code) === setCode)
    && (!collector || normalizedCollector(candidate.collector_number) === collector)
  );
  if ((setCode || collector) && exactMatches.length) {
    return exactMatches[0].printing_id;
  }

  const preference = normalizedSet(preferredSet);
  const preferredGameKey = normalizedSet(preferredGame);
  const preferredMatches = titleMatches.filter((candidate) =>
    preference
    && normalizedSet(candidate.set.code) === preference
    && (!preferredGameKey || normalizedSet(candidate.set.game) === preferredGameKey),
  );
  if (preferredMatches.length) return preferredMatches[0].printing_id;

  return titleMatches[0]?.printing_id ?? "";
}
