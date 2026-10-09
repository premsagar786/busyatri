import { create } from "zustand";

interface TripState {
  busNumber: string | null;
  route: string | null;
  destination: string | null;
  token: string | null;
  tripId: string | null;
  active: boolean;
  startedAt: string | null;
  queued: number;
  sent: number;
  lastSync: string | null;
  online: boolean;
  speed: number | null;
  accuracy: number | null;
  set: (p: Partial<TripState>) => void;
  reset: () => void;
}

export const useTrip = create<TripState>((set) => ({
  busNumber: null,
  route: null,
  destination: null,
  token: null,
  tripId: null,
  active: false,
  startedAt: null,
  queued: 0,
  sent: 0,
  lastSync: null,
  online: true,
  speed: null,
  accuracy: null,
  set: (p) => set(p),
  reset: () => set({ tripId: null, active: false, startedAt: null, queued: 0, sent: 0, lastSync: null, speed: null, accuracy: null }),
}));
