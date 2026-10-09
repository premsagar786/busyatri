import { NET } from "./config";

export interface BusProfile {
  id: number;
  bus_number: string;
  route: string | null;
  destination: string | null;
}

// Verifies the driver token against the live backend and returns the
// assigned bus profile. Throws on invalid token / unreachable server.
export async function fetchMyBus(apiUrl: string, token: string): Promise<BusProfile> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), NET.requestTimeoutMs);
  try {
    const res = await fetch(`${apiUrl}/api/v1/buses/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    if (res.status === 401) throw new Error("Token invalid — ask admin for a new one.");
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    return (await res.json()) as BusProfile;
  } catch (err: unknown) {
    if ((err as Error)?.name === "AbortError") throw new Error("Server unreachable — check network / API URL.");
    throw err instanceof Error ? err : new Error("Login failed");
  } finally {
    clearTimeout(t);
  }
}
