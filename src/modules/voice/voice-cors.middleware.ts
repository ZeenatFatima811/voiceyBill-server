import cors from "cors";

/**
 * Voice-specific CORS layer, ported verbatim from `routes/voice.route.ts`.
 *
 * Its origin list is broader than the global policy — it also matches any
 * `*voiceybill*.vercel.app` preview deployment — but that extra breadth is
 * UNREACHABLE, and was unreachable before this migration too.
 *
 * This is route-scoped middleware, so it runs after the global
 * `cors(corsOptions)` in `main.ts`'s pre-router stack. An origin the global
 * policy refuses is already rejected by the time this runs, exactly as in the
 * old Express app (global `cors` at `index.ts:92`, voice router mounted below
 * it). Kept as-is to preserve behaviour; `test/middleware.e2e-spec.ts` pins it.
 *
 * Genuinely allowing preview origins means changing the global policy, which is
 * a deliberate behaviour change and belongs in its own PR.
 */
export const voiceCors = cors({
  origin(
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) {
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      "http://localhost:5173",
      "https://voiceybill.vercel.app",
      "https://voiceybill.com",
      "https://www.voiceybill.com",
    ];

    const isAllowed =
      allowedOrigins.includes(origin) ||
      (origin.includes("voiceybill") && origin.includes("vercel.app"));

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "Origin",
    "X-Requested-With",
  ],
  optionsSuccessStatus: 200,
});
