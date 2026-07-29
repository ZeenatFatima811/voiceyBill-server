import cors from "cors";

/**
 * Voice-specific CORS layer, ported verbatim from `routes/voice.route.ts`.
 *
 * Deliberately broader than the global policy: it additionally accepts any
 * `*voiceybill*.vercel.app` preview deployment, which is how the web client's
 * branch previews reach the voice endpoint.
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
