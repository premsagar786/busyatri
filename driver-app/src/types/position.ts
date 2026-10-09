import { z } from "zod";

export const PointSchema = z.object({
  point_id: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative().optional(),
  speed_mps: z.number().nonnegative().optional(),
  recorded_at: z.string().datetime(),
});

export type Point = z.infer<typeof PointSchema>;

export interface QueuedPoint extends Point {
  trip_id: string;
  synced: number;
  flagged: number;
}
