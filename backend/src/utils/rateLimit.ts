import rateLimit from "express-rate-limit";

export const positionLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60, // 60 batches/min per key — enough for 2 buses + retries
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const auth = (req.headers.authorization as string) || req.ip || "anon";
    return auth.slice(0, 64);
  },
  message: { error: "rate_limited" },
});

export const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
