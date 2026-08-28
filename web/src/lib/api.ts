interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    fields?: Array<{ field: string; message: string }> | null;
    request_id?: string;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
    public readonly fields?: Array<{ field: string; message: string }> | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError(
      "network_unavailable",
      "The WynterLabs service is unavailable. Check your connection and try again.",
      0,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? ((await response.json()) as ErrorEnvelope & T) : undefined;
  if (!response.ok) {
    throw new ApiError(
      body?.error?.code ?? "request_failed",
      body?.error?.message ?? "The request could not be completed.",
      response.status,
      body?.error?.request_id,
      body?.error?.fields,
    );
  }
  return body as T;
}
