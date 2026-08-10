/**
 * ObjectId-compatible identifier generation for Postgres.
 *
 * Every primary key in the Postgres schema is a 24-character lowercase hex
 * string in MongoDB's ObjectId format, NOT a UUID. That is a deliberate
 * migration constraint, not an accident:
 *
 *  • The web and mobile clients read `_id` off every payload (35 references in
 *    voiceyBill-web, 37 in voiceyBill-App). Keeping the format identical means
 *    neither client changes.
 *  • Already-issued JWTs carry `userId` as an ObjectId hex string. Preserving
 *    the format means live sessions survive the cutover instead of every user
 *    being silently logged out.
 *  • Existing Atlas rows migrate with their `_id` values intact, so the backfill
 *    is a straight copy and a rollback to Mongo stays possible mid-migration.
 *
 * The layout matches the BSON ObjectId spec, so values remain k-sortable by
 * creation time exactly as they were under Mongo:
 *
 *   bytes 0-3   big-endian seconds since the Unix epoch
 *   bytes 4-8   per-process random value, constant for the process lifetime
 *   bytes 9-11  big-endian counter, randomly seeded, wrapping at 2^24
 */
import { randomBytes } from "crypto";

const OBJECT_ID_LENGTH = 24;
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/;

/**
 * Wrap mask for the 3-byte counter, i.e. 2^24 - 1.
 *
 * A bitmask rather than `% 2^24`. The two are arithmetically identical here —
 * the seed already spans exactly [0, 2^24) — but a remainder applied to a value
 * derived from `randomBytes` is the shape of a real bias bug (reducing a wide
 * random range into a narrower one keeps the low values more likely), and static
 * analysis flags it as such without being able to prove the ranges match. Masking
 * on a power-of-two boundary is unbiased by construction, so the invariant is
 * visible in the code rather than argued in a comment.
 */
const COUNTER_MASK = 0xffffff;

/** Per-process random value: bytes 4-8 of every id this process generates. */
const PROCESS_RANDOM = randomBytes(5);

/**
 * Randomly seeded so two processes starting in the same second do not emit
 * overlapping counter ranges. Wraps at 2^24, matching the BSON spec.
 */
let counter = randomBytes(3).readUIntBE(0, 3);

const nextCounter = (): number => {
  const value = counter;
  counter = (counter + 1) & COUNTER_MASK;
  return value;
};

/**
 * Generates a new ObjectId-format hex string.
 *
 * `at` overrides the embedded timestamp, for tests and backfills that need
 * reproducible ids.
 */
export const newObjectId = (at?: Date): string => {
  const buffer = Buffer.allocUnsafe(12);
  const seconds = Math.floor((at ? at.getTime() : Date.now()) / 1000);

  buffer.writeUInt32BE(seconds >>> 0, 0);
  PROCESS_RANDOM.copy(buffer, 4);
  buffer.writeUIntBE(nextCounter(), 9, 3);

  return buffer.toString("hex");
};

/** True when `value` is a well-formed 24-character lowercase hex id. */
export const isObjectId = (value: unknown): value is string =>
  typeof value === "string" && OBJECT_ID_PATTERN.test(value);

/**
 * Normalises anything id-shaped to a lowercase hex string.
 *
 * Mongo accepted both a 24-hex string and an ObjectId instance in the same
 * position, and callers throughout the services rely on that leniency (route
 * params arrive as strings, `user._id` arrived as an ObjectId). Returns null
 * rather than throwing so callers keep their existing "not found" behaviour
 * for malformed ids instead of surfacing a new 500.
 */
export const toObjectId = (value: unknown): string | null => {
  if (isObjectId(value)) return value;

  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    return OBJECT_ID_PATTERN.test(lowered) ? lowered : null;
  }

  // An ObjectId instance, or any wrapper whose toHexString/toString yields one.
  if (value && typeof value === "object") {
    const candidate = value as { toHexString?: () => string };
    const hex =
      typeof candidate.toHexString === "function"
        ? candidate.toHexString()
        : String(value);
    const lowered = hex.toLowerCase();
    return OBJECT_ID_PATTERN.test(lowered) ? lowered : null;
  }

  return null;
};

/** The creation time embedded in an id, or null if `value` is malformed. */
export const objectIdTimestamp = (value: string): Date | null => {
  if (!isObjectId(value)) return null;
  return new Date(parseInt(value.slice(0, 8), 16) * 1000);
};

export { OBJECT_ID_LENGTH, OBJECT_ID_PATTERN };
