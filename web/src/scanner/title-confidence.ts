import type { ScanCandidate } from "../lib/types";

const MIN_TITLE_SIMILARITY = 0.72;

function normalizeTitle(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function titleMatches(query: string, candidate: string) {
  const normalizedQuery = normalizeTitle(query);
  const normalizedCandidate = normalizeTitle(candidate);
  if (normalizedQuery.length < 3 || normalizedCandidate.length < 3) return false;
  if (
    normalizedCandidate === normalizedQuery
    || normalizedCandidate.startsWith(`${normalizedQuery} `)
  ) return true;
  const length = Math.max(normalizedQuery.length, normalizedCandidate.length);
  return 1 - editDistance(normalizedQuery, normalizedCandidate) / length >= MIN_TITLE_SIMILARITY;
}

export function filterConfidentScanCandidates(
  title: string,
  candidates: ScanCandidate[],
) {
  return candidates.filter((candidate) => titleMatches(title, candidate.name));
}
