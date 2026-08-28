import { apiRequest } from "./api";

export interface TradingAccount {
  status: "active" | "suspended";
  active_strikes: number;
  revision: number;
  suspended_at: string | null;
  support_email: string;
}

export interface TradeListing {
  id: string;
  collection_item_id: string;
  printing_id: string;
  oracle_id: string;
  card_name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  finish: string;
  condition: string;
  owned_quantity: number;
  quantity: number;
  status: "active" | "removed";
  revision: number;
}

export interface WantListing {
  id: string;
  oracle_id: string;
  printing_id: string | null;
  finish: string | null;
  condition: string | null;
  quantity: number;
  card_name: string;
  status: "active" | "removed";
  revision: number;
}

export interface TradeMatch {
  want_id: string;
  listing_id: string;
  member_display_name: string;
  printing_id: string;
  oracle_id: string;
  card_name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  finish: string;
  condition: string;
  available_quantity: number;
}

export interface TradeReport {
  id: string;
  incident_reference: string;
  reporter_display_name: string | null;
  reported_user_id: string;
  reported_display_name: string;
  reported_trading_status?: "active" | "suspended" | null;
  reported_active_strikes?: number | null;
  reported_trading_revision?: number | null;
  listing_id: string | null;
  listing_revision?: number | null;
  strike_id?: string | null;
  strike_revision?: number | null;
  strike_status?: "active" | "void" | null;
  reason: string;
  details: string | null;
  status: "open" | "upheld" | "dismissed";
  revision: number;
  created_at: string;
}

interface Page<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  pages: number;
}

export const getTradingAccount = (signal?: AbortSignal) =>
  apiRequest<TradingAccount>("/api/v1/trading/account", { signal });
export const getTrades = (signal?: AbortSignal) =>
  apiRequest<Page<TradeListing>>("/api/v1/trades?page=1&page_size=100", { signal });
export const createTrade = (
  payload: { collection_item_id: string; quantity: number },
  signal?: AbortSignal,
) => apiRequest<TradeListing>("/api/v1/trades", {
  method: "POST", body: JSON.stringify(payload), signal,
});
export const updateTrade = (
  id: string,
  payload: { quantity: number; status: "active" | "removed"; expected_revision: number },
  signal?: AbortSignal,
) => apiRequest<TradeListing>(`/api/v1/trades/${encodeURIComponent(id)}`, {
  method: "PUT", body: JSON.stringify(payload), signal,
});
export const deleteTrade = (id: string, revision: number, signal?: AbortSignal) =>
  apiRequest<void>(
    `/api/v1/trades/${encodeURIComponent(id)}?expected_revision=${revision}`,
    { method: "DELETE", signal },
  );

export const getWants = (signal?: AbortSignal) =>
  apiRequest<Page<WantListing>>("/api/v1/wants?page=1&page_size=100", { signal });
export const createWant = (
  payload: {
    oracle_id: string;
    printing_id: string | null;
    finish: string | null;
    condition: string | null;
    quantity: number;
  },
  signal?: AbortSignal,
) => apiRequest<WantListing>("/api/v1/wants", {
  method: "POST", body: JSON.stringify(payload), signal,
});
export const deleteWant = (id: string, revision: number, signal?: AbortSignal) =>
  apiRequest<void>(
    `/api/v1/wants/${encodeURIComponent(id)}?expected_revision=${revision}`,
    { method: "DELETE", signal },
  );

export const getTradeMatches = (signal?: AbortSignal) =>
  apiRequest<Page<TradeMatch>>("/api/v1/trade-matches?page=1&page_size=100", { signal });
export const reportTrade = (
  payload: { listing_id: string; reason: string; details: string | null },
  signal?: AbortSignal,
) => apiRequest<TradeReport>("/api/v1/trade-reports", {
  method: "POST", body: JSON.stringify(payload), signal,
});
export const getMyTradeReports = (signal?: AbortSignal) =>
  apiRequest<TradeReport[]>("/api/v1/trade-reports", { signal });

export const getModerationReports = (signal?: AbortSignal) =>
  apiRequest<TradeReport[]>("/api/v1/admin/trade-moderation/reports", { signal });
export const moderateReport = (
  id: string,
  payload: { action: "uphold" | "dismiss"; expected_revision: number; note: string | null },
) => apiRequest<TradeReport>(
  `/api/v1/admin/trade-moderation/reports/${encodeURIComponent(id)}`,
  { method: "POST", body: JSON.stringify(payload) },
);
export const moderateListing = (
  id: string,
  payload: { status: "active" | "removed"; expected_revision: number; note: string | null },
) => apiRequest<TradeListing>(
  `/api/v1/admin/trade-moderation/listings/${encodeURIComponent(id)}`,
  { method: "POST", body: JSON.stringify(payload) },
);
export const voidTradeStrike = (
  id: string,
  payload: { expected_revision: number; note: string | null },
) => apiRequest<TradingAccount>(
  `/api/v1/admin/trade-moderation/strikes/${encodeURIComponent(id)}/void`,
  { method: "POST", body: JSON.stringify(payload) },
);
export const setMemberTradingStatus = (
  userId: string,
  payload: { status: "active" | "suspended"; expected_revision: number; note: string | null },
) => apiRequest<TradingAccount>(
  `/api/v1/admin/trade-moderation/users/${encodeURIComponent(userId)}/trading`,
  { method: "POST", body: JSON.stringify(payload) },
);
export const setMemberAccountStatus = (
  userId: string,
  payload: { is_active: boolean; note: string | null },
) => apiRequest<void>(
  `/api/v1/admin/trade-moderation/users/${encodeURIComponent(userId)}/account-status`,
  { method: "POST", body: JSON.stringify(payload) },
);
