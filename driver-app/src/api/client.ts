import { NET } from "./config";
import { getApiUrl } from "./endpoint";

export class HttpError extends Error {
  status: number;
  retryAfter?: number;
  constructor(status: number, msg: string, retryAfter?: number) {
    super(msg);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export async function postJSON(path: string, token: string, body: unknown, gzipBytes?: Uint8Array): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), NET.requestTimeoutMs);
  // NOTE: resolves the QR-scanned server override, else the baked default.
  const base = await getApiUrl();
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    let payload: string | Uint8Array;
    if (gzipBytes) {
      headers["Content-Encoding"] = "gzip";
      payload = gzipBytes as unknown as string;
    } else {
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: payload as BodyInit,
      signal: ctrl.signal,
    });
    if (res.status === 401) throw new HttpError(401, "Token invalid, ask admin");
    if (res.status === 413) throw new HttpError(413, "Batch too large");
    if (res.status === 429) {
      const ra = Number(res.headers.get("Retry-After") || 0);
      throw new HttpError(429, "Rate limited", ra > 0 ? ra * 1000 : undefined);
    }
    if (res.status >= 500) throw new HttpError(res.status, `Server error ${res.status}`);
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`);
    return await res.json();
  } catch (err: unknown) {
    if (err instanceof HttpError) throw err;
    if ((err as Error)?.name === "AbortError") throw new HttpError(599, "timeout");
    throw new HttpError(599, `network: ${(err as Error)?.message || "unknown"}`);
  } finally {
    clearTimeout(t);
  }
}
