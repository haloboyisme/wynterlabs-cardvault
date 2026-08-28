import { apiRequest } from "./api";
import type {
  CardSummary,
  CardDetail,
  CardPage,
  CardSearchParams,
  CatalogStatus,
  PrintingPage,
  ScanCandidate,
  SetPage,
} from "./types";

const API = "/api/v1/catalog";

const SORTS = new Set(["relevance", "name", "released", "set", "collector", "rarity"]);

export function buildCardSearch(params: CardSearchParams): string {
  const query = new URLSearchParams();
  const values: Array<[string, string | number | undefined]> = [
    ["q", params.q?.trim() || undefined],
    ["set", params.set],
    ["game", params.game?.trim().toLocaleLowerCase() || undefined],
    ["collector", params.collector?.trim() || undefined],
    ["rarity", params.rarity],
    ["color", params.color],
    ["type", params.type?.trim() || undefined],
    ["legality", params.legality],
    ["finish", params.finish],
    ["sort", params.sort && SORTS.has(params.sort) ? params.sort : undefined],
    ["page", Math.max(1, params.page ?? 1)],
    ["page_size", Math.min(100, Math.max(1, params.page_size ?? 25))],
  ];
  for (const [key, value] of values) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  return `${API}/cards?${query.toString()}`;
}

export const getCatalogStatus = (signal?: AbortSignal) =>
  apiRequest<CatalogStatus>(`${API}/status`, { signal });
export const getCatalogSets = (page = 1, signal?: AbortSignal) =>
  apiRequest<SetPage>(`${API}/sets?page=${page}&page_size=200`, { signal });
export async function getAllCatalogSets(signal?: AbortSignal, pageCeiling = 100) {
  const first = await getCatalogSets(1, signal);
  if (!Number.isInteger(first.pages) || first.pages < 0 || first.pages > pageCeiling) {
    throw new Error("Catalog set page count is outside safe bounds.");
  }
  if (first.pages <= 1) return first;
  const remaining = await Promise.all(
    Array.from({ length: first.pages - 1 }, (_, index) =>
      getCatalogSets(index + 2, signal),
    ),
  );
  return { ...first, items: [first, ...remaining].flatMap((page) => page.items) };
}
export const searchCards = (params: CardSearchParams, signal?: AbortSignal) =>
  apiRequest<CardPage>(buildCardSearch(params), { signal });
export const getCard = (printingId: string, signal?: AbortSignal) =>
  apiRequest<CardDetail>(`${API}/cards/${encodeURIComponent(printingId)}`, { signal });
export function getPrintings(
  oracleId: string,
  page = 1,
  signal?: AbortSignal,
  game?: string,
) {
  const query = new URLSearchParams({ page: String(page), page_size: "200" });
  const normalizedGame = game?.trim().toLocaleLowerCase();
  if (normalizedGame) query.set("game", normalizedGame);
  return apiRequest<PrintingPage>(
    `${API}/oracle/${encodeURIComponent(oracleId)}/printings?${query}`,
    { signal },
  );
}

export async function getAllOraclePrintings(
  oracleId: string,
  signal?: AbortSignal,
  pageCeiling = 50,
  game?: string,
): Promise<CardSummary[]> {
  const first = await getPrintings(oracleId, 1, signal, game);
  if (!Number.isInteger(first.pages) || first.pages < 0 || first.pages > pageCeiling) {
    throw new Error("Printing page count is outside safe bounds.");
  }
  if (first.pages <= 1) return first.items;
  const remaining = await Promise.all(
    Array.from({ length: first.pages - 1 }, (_, index) =>
      getPrintings(oracleId, index + 2, signal, game),
    ),
  );
  return [first, ...remaining].flatMap((page) => page.items);
}

export async function expandScanCandidates(
  seeds: ScanCandidate[],
  signal?: AbortSignal,
  game?: string,
): Promise<ScanCandidate[]> {
  const normalizedGame = game?.trim().toLocaleLowerCase();
  const oracleIds = [...new Set(seeds.map((seed) => seed.oracle_id))];
  const printings = await Promise.all(
    oracleIds.map((oracleId) => getAllOraclePrintings(oracleId, signal, 50, normalizedGame)),
  );
  const reasons = new Map(seeds.map((seed) => [seed.oracle_id, seed.rank_reason]));
  return printings.flatMap((items) => items
    .filter((printing) => !normalizedGame || printing.set.game === normalizedGame)
    .map((printing) => ({
      ...printing,
      rank_reason: reasons.get(printing.oracle_id) ?? "exact_name",
    })));
}

export function getScanCandidates(
  hints: {
    name: string;
    set?: string;
    collector?: string;
    preferredSet?: string;
    preferredGame?: string;
    game?: string;
    limit?: number;
  },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    name: hints.name.trim(),
    limit: String(Math.min(20, Math.max(1, hints.limit ?? 10))),
  });
  const setCode = hints.set?.trim().toLowerCase();
  const preferredSet = hints.preferredSet?.trim().toLowerCase();
  const collector = hints.collector?.trim();
  const game = hints.game?.trim().toLocaleLowerCase();
  const preferredGame = hints.preferredGame?.trim().toLocaleLowerCase();
  if (setCode) query.set("set", setCode);
  if (collector) query.set("collector", collector);
  if (preferredSet) query.set("preferred_set", preferredSet);
  if (preferredGame) query.set("preferred_game", preferredGame);
  if (game) query.set("game", game);
  return apiRequest<ScanCandidate[]>(`${API}/scan-candidates?${query}`, { signal });
}
