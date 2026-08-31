export interface User {
  id: string;
  email: string;
  display_name: string;
  role: "owner" | "super_admin" | "admin" | "member";
  created_at: string;
  must_change_password: boolean;
}

export type LoginResult =
  | { status: "authenticated"; user: User; challenge_expires_at: null }
  | { status: "mfa_required"; user: null; challenge_expires_at: string };

export interface MfaStatus {
  eligible: boolean;
  enabled: boolean;
  recovery_codes_remaining: number;
}

export interface MfaEnrollment {
  secret: string;
  otpauth_uri: string;
  expires_at: string;
}

export interface Session {
  id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  client_ip: string;
  user_agent: string;
  current: boolean;
}
export interface CatalogCounts {
  sets: number;
  oracle_cards: number;
  printings: number;
}

export interface CatalogStatus {
  ready: boolean;
  stale: boolean;
  source_updated_at: string | null;
  completed_at: string | null;
  counts: CatalogCounts;
}

export interface CardSet {
  id: string;
  code: string;
  name: string;
  set_type: string;
  released_at: string | null;
  card_count: number;
  digital: boolean;
  icon_svg_uri: string | null;
  game: string;
}

export interface CardFace {
  face_index: number;
  name: string;
  mana_cost: string | null;
  type_line: string | null;
  oracle_text: string | null;
  colors: string[];
  image_uris: Record<string, string>;
  artist: string | null;
}

export interface CardSummary {
  printing_id: string;
  oracle_id: string;
  name: string;
  mana_cost: string | null;
  type_line: string | null;
  set: CardSet;
  collector_number: string;
  rarity: string;
  released_at: string | null;
  language: string;
  layout: string;
  image_uris: Record<string, string>;
  prices: Record<string, string | null>;
  finishes: string[];
  colors: string[];
  active: boolean;
}

export interface ScanCandidate extends CardSummary {
  rank_reason: "exact_printing" | "exact_name" | "name_prefix" | "fuzzy_name";
}

export interface CardDetail extends CardSummary {
  oracle_text: string | null;
  cmc: number;
  color_identity: string[];
  keywords: string[];
  legalities: Record<string, string>;
  artist: string | null;
  digital: boolean;
  promo: boolean;
  frame: string | null;
  border_color: string | null;
  image_status: string | null;
  source_uri: string | null;
  price_snapshot_at: string | null;
  games: string[];
  faces: CardFace[];
}

export interface CardPage {
  items: CardSummary[];
  page: number;
  page_size: number;
  total: number;
  pages: number;
}

export type PrintingPage = CardPage;
export interface SetPage {
  items: CardSet[];
  page: number;
  page_size: number;
  total: number;
  pages: number;
}

export type CardSort = "relevance" | "name" | "released" | "set" | "collector" | "rarity";
export interface CardSearchParams {
  q?: string;
  set?: string;
  game?: string;
  collector?: string;
  rarity?: string;
  color?: string;
  type?: string;
  legality?: string;
  finish?: string;
  page?: number;
  sort?: CardSort;
  page_size?: number;
}

export type CollectionCondition = "near_mint" | "lightly_played" | "moderately_played" | "heavily_played" | "damaged";
export type CollectionPriceStatus = "priced" | "missing";
export type CollectionSort =
  | "updated"
  | "created_desc"
  | "created_asc"
  | "name"
  | "name_desc"
  | "quantity"
  | "quantity_asc"
  | "price_desc"
  | "price_asc"
  | "missing_price";
export type CollectionPageSize = 25 | 50 | 75 | 100;

export interface CollectionItem {
  id: string;
  printing_id: string;
  finish: string;
  condition: CollectionCondition;
  quantity: number;
  revision: number;
  created_at: string;
  updated_at: string;
  card: CardSummary;
}

export interface CollectionPageData {
  items: CollectionItem[];
  page: number;
  page_size: number;
  total: number;
  pages: number;
}

export interface CollectionMissingPriceItem {
  id: string;
  printing_id: string;
  finish: string;
  condition: CollectionCondition;
  quantity: number;
  revision: number;
  manual_price_usd: string | null;
  source_uri: string | null;
  card: CardSummary;
}

export interface CollectionMissingPricePage {
  items: CollectionMissingPriceItem[];
  page: number;
  page_size: number;
  total: number;
  pages: number;
}

export interface CollectionManualPriceResult {
  id: string;
  manual_price_usd: string;
  revision: number;
}

export interface CollectionSummary {
  total_copies: number;
  distinct_items: number;
  distinct_oracle_cards: number;
  distinct_sets: number;
  estimated_value_usd: string;
  priced_copies: number;
  unpriced_copies: number;
  price_snapshot_at: string | null;
  finishes: CollectionBreakdown[];
  conditions: CollectionBreakdown[];
  sets: CollectionSetSummary[];
}

export type CollectionValueRange = "hour" | "day" | "week" | "month" | "quarter" | "year" | "all";

export interface CollectionValuePoint {
  timestamp: string;
  estimated_value_usd: string;
  priced_copies: number;
  unpriced_copies: number;
  total_copies: number;
  oldest_price_snapshot_at: string | null;
}

export interface CollectionValueHistory {
  range: CollectionValueRange;
  points: CollectionValuePoint[];
  current_value_usd: string;
  change_usd: string;
  change_percent: string | null;
  priced_copies: number;
  unpriced_copies: number;
  total_copies: number;
}

export interface CollectionBreakdown {
  value: string;
  copies: number;
}

export interface CollectionSetSummary {
  code: string;
  name: string;
  copies: number;
  distinct_items: number;
  game: string;
}

export interface CollectionSearchParams {
  q?: string;
  set?: string;
  game?: string;
  collector_number?: string;
  rarity?: string;
  finish?: string;
  condition?: CollectionCondition | "";
  price_status?: CollectionPriceStatus;
  sort?: CollectionSort;
  page?: number;
  page_size?: number;
}

export interface CollectionItemCreate {
  printing_id: string;
  finish: string;
  condition: CollectionCondition;
  quantity: number;
}

export interface CollectionItemUpdate {
  finish?: string;
  condition?: CollectionCondition;
  quantity?: number;
  expected_revision: number;
}

export type CollectionImportClassification = "addition" | "increment" | "error";

export interface CollectionImportRow {
  source_row: number;
  printing_id: string;
  card_name: string;
  finish: string;
  condition: CollectionCondition;
  quantity: number;
  classification: CollectionImportClassification;
  existing_quantity: number;
  resulting_quantity: number;
  error_code: string | null;
  error_message: string | null;
  warnings: string[];
}

export interface CollectionImportSummary {
  additions: number;
  increments: number;
  errors: number;
  total_rows: number;
}

export interface CollectionImportPreview {
  id: string;
  rows: CollectionImportRow[];
  summary: CollectionImportSummary;
  revision: number;
  expires_at: string;
  confirmed_at: string | null;
}

export interface CollectionImportConfirmation {
  preview_id: string;
  applied_rows: number;
}

export type DeckFormat =
  | "standard" | "future" | "historic" | "timeless" | "gladiator"
  | "pioneer" | "explorer" | "modern" | "legacy" | "pauper"
  | "vintage" | "penny" | "commander" | "oathbreaker"
  | "standardbrawl" | "brawl" | "alchemy" | "paupercommander"
  | "duel" | "oldschool" | "premodern" | "predh"
  | "expanded" | "unlimited" | "advanced" | "traditional";

export type DeckSection =
  | "mainboard" | "sideboard" | "companion" | "maybeboard"
  | "commander" | "oathbreaker" | "signature_spell";

export interface Deck {
  id: string;
  name: string;
  game?: string;
  format: DeckFormat;
  description: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface DeckWarning {
  code: string;
  message: string;
  printing_id: string | null;
}

export interface DeckCard {
  id: string;
  printing_id: string;
  section: DeckSection;
  quantity: number;
  revision: number;
  owned_quantity: number;
  card: CardSummary;
}

export interface DeckDetail extends Deck {
  cards: DeckCard[];
  mainboard_count: number;
  sideboard_count: number;
  warnings: DeckWarning[];
}

export interface DeckPage {
  items: Deck[];
  total: number;
}

export interface DeckInput {
  name: string;
  game?: string;
  format: DeckFormat;
  description: string | null;
}
