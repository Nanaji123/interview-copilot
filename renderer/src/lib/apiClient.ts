const API_BASE = process.env.VITE_PUBLIC_API_BASE?.replace(/\/$/, "") || "";

export interface ApiError extends Error {
  status: number;
  payload?: unknown;
}

interface ApiFetchOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
  /**
   * Whether to attach Supabase access token. Defaults to true.
   */
  auth?: boolean;
  /** If true, skip JSON parsing and return raw Response. */
  raw?: boolean;
}

/**
 * Centralized fetch wrapper that automatically injects the Supabase access token
 * and normalizes JSON responses & errors.
 */
export async function apiFetch<T = unknown>(
  path: string,
  { auth = true, raw = false, headers = {}, ...init }: ApiFetchOptions = {}
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : `${API_BASE}${path.startsWith("/") ? path : "/" + path}`;

  let finalHeaders: Record<string, string> = {
    Accept: "application/json",
    ...headers,
  };

  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !finalHeaders["Content-Type"]
  ) {
    finalHeaders["Content-Type"] = "application/json";
  }

  const response = await fetch(url, { ...init, headers: finalHeaders });

  if (raw) return response as unknown as T;

  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");
  const payload = isJson
    ? await response.json().catch(() => undefined)
    : undefined;

  if (!response.ok) {
    const err: ApiError = Object.assign(
      new Error(
        (payload as any)?.message || `Request failed (${response.status})`
      ),
      {
        status: response.status,
        payload,
      }
    );
    throw err;
  }

  return payload as T;
}

// Convenience helpers
export const api = {
  get: <T = unknown>(path: string, opts?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...opts, method: "GET" }),
  post: <T = unknown>(path: string, body?: any, opts?: ApiFetchOptions) =>
    apiFetch<T>(path, {
      ...opts,
      method: "POST",
      body: body && !(body instanceof FormData) ? JSON.stringify(body) : body,
    }),
  put: <T = unknown>(path: string, body?: any, opts?: ApiFetchOptions) =>
    apiFetch<T>(path, {
      ...opts,
      method: "PUT",
      body: body && !(body instanceof FormData) ? JSON.stringify(body) : body,
    }),
  del: <T = unknown>(path: string, opts?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...opts, method: "DELETE" }),
};
