import { apiRequest } from "./api";

export interface CommunityActivity {
  kind: "card_added" | "new_member" | "catalog_updated" | "set_updated";
  occurred_at: string;
  display_name: string | null;
  printing_id: string | null;
  card_name: string | null;
  set_name: string | null;
  set_code: string | null;
  collector_number: string | null;
  image_uris: Record<string, string>;
  game: string | null;
  printing_count: number | null;
  set_count: number | null;
  released_at: string | null;
}

export function getCommunityActivity(signal?: AbortSignal) {
  return apiRequest<{ items: CommunityActivity[] }>("/api/v1/community/activity", { signal });
}
