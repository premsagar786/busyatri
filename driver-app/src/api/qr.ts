// BusYatri driver QR payload — dependency-free so it can be unit-tested
// anywhere. Shape: {"v":1,"api":"https://…","bus":"BUS 01","token":"bt_…"}
// The QR is a bearer credential: whoever scans it signs in as that bus.
// If one leaks, admin rotates the token (dashboard → REISSUE QR).

export interface BusQr {
  v: 1;
  api: string;
  bus: string;
  token: string;
}

export function parseQrPayload(raw: string): BusQr {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    throw new Error("Not a BusYatri QR — point the camera at the admin's bus code.");
  }
  if (typeof j !== "object" || j === null || (j as { v?: unknown }).v !== 1) {
    throw new Error("Unknown QR version — ask admin to reprint it from this dashboard.");
  }
  const o = j as Record<string, unknown>;
  const api = String(o.api ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+/i.test(api)) {
    throw new Error("QR has a bad server address — ask admin to reprint it.");
  }
  const token = String(o.token ?? "").trim();
  if (!token) {
    throw new Error("QR has no sign-in token — ask admin to reprint it.");
  }
  return { v: 1, api, bus: String(o.bus ?? "").trim().toUpperCase(), token };
}

export function buildQrPayload(api: string, bus: string, token: string): string {
  return JSON.stringify({ v: 1, api: api.trim().replace(/\/+$/, ""), bus, token });
}
