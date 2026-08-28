import { apiRequest } from "./api";

export interface PrivateOcrHints {
  name: string;
  titleCandidates: string[];
  set?: string;
  collector?: string;
  rawText: string;
}

interface PrivateOcrResponse {
  name: string;
  title_candidates: string[];
  set?: string | null;
  collector?: string | null;
  raw_text: string;
}

export async function recognizeCardPhoto(
  photo: Blob,
  signal?: AbortSignal,
): Promise<PrivateOcrHints> {
  const result = await apiRequest<PrivateOcrResponse>("/api/v1/scanner/recognize", {
    method: "POST",
    body: photo,
    signal,
    headers: { "content-type": photo.type || "image/jpeg" },
  });
  return {
    name: result.name,
    titleCandidates: result.title_candidates,
    ...(result.set ? { set: result.set } : {}),
    ...(result.collector ? { collector: result.collector } : {}),
    rawText: result.raw_text,
  };
}
