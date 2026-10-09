import { postJSON } from "./client";

export async function uploadBatch(token: string, body: { trip_id: string; source: string; points: unknown[] }) {
  const json = JSON.stringify(body);
  return postJSON("/api/v1/positions/batch", token, body, json.length > 1024 ? (json as unknown as Uint8Array) : undefined);
}

export async function endTripRemote(apiUrl: string, tripCode: string, token: string) {
  const res = await fetch(`${apiUrl}/api/v1/buses/trips/${encodeURIComponent(tripCode)}/end`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`end trip failed: ${res.status}`);
  return res.json();
}
