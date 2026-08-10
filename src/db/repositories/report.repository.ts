/**
 * reports and report_settings repository.
 *
 * The monthly cron writes both tables through a `bulkWrite` of upserts inside
 * one transaction. Those become `ON CONFLICT` upserts here, threaded through
 * the same `Executor` so they still commit together.
 */
import { and, asc, count, desc, eq, lte } from "drizzle-orm";

import {
  toReportApi,
  toReportApiList,
  toReportRow,
  toReportSettingApi,
  toReportSettingApiList,
  toReportSettingRow,
  toReportSettingUpdate,
  toReportUpdate,
  type ReportApi,
  type ReportInput,
  type ReportSettingApi,
  type ReportSettingInput,
} from "../mappers/misc.mapper";
import { newObjectId, toObjectId } from "../object-id";
import { reportSettings, reports } from "../schema/reports";
import { executor, type Executor } from "../unit-of-work";

const one = <T>(rows: T[]): T | null => rows[0] ?? null;
const validId = (id: string): string | null => toObjectId(id);

// ---------------------------------------------------------------------------
// reports
// ---------------------------------------------------------------------------

export const listByUser = async (
  userId: string,
  options: { skip?: number; limit?: number } = {},
  exec?: Executor,
): Promise<ReportApi[]> => {
  const owner = validId(userId);
  if (!owner) return [];

  // `_id` breaks createdAt ties so pagination cannot repeat or skip a row.
  const query = executor(exec)
    .select()
    .from(reports)
    .where(eq(reports.userId, owner))
    .orderBy(desc(reports.createdAt), desc(reports.id));

  if (options.limit !== undefined) query.limit(options.limit);
  if (options.skip !== undefined) query.offset(options.skip);

  return toReportApiList(await query);
};

export const countByUser = async (userId: string, exec?: Executor): Promise<number> => {
  const owner = validId(userId);
  if (!owner) return 0;

  const [row] = await executor(exec)
    .select({ value: count() })
    .from(reports)
    .where(eq(reports.userId, owner));
  return row?.value ?? 0;
};

export const findById = async (
  id: string,
  userId?: string,
  exec?: Executor,
): Promise<ReportApi | null> => {
  const key = validId(id);
  if (!key) return null;

  const clauses = [eq(reports.id, key)];
  if (userId) {
    const owner = validId(userId);
    if (!owner) return null;
    clauses.push(eq(reports.userId, owner));
  }

  const rows = await executor(exec)
    .select()
    .from(reports)
    .where(and(...clauses));
  const row = one(rows);
  return row ? toReportApi(row) : null;
};

export type CreateReportInput = Omit<ReportInput, "id"> & { id?: string };

/**
 * Plain insert — the monthly cron's audit row.
 *
 * Distinct from `upsertForPeriod`: the cron records that a run HAPPENED, and
 * always adds a row, where `generateReportService` maintains one row per
 * period. Both run in the same transaction, so a cron pass writes two rows,
 * which is what the Mongo version did with a `findOneAndUpdate` followed by a
 * `bulkWrite` insertOne.
 *
 * NOTE the cron's Mongo document omitted `startDate`/`endDate` even though the
 * schema marked both required. Here they are NOT NULL, so the caller supplies
 * the period it just reported on — which is the value the omitted fields should
 * always have held.
 */
export const create = async (
  input: CreateReportInput,
  exec?: Executor,
): Promise<ReportApi> => {
  const row = toReportRow({ ...input, id: input.id ?? newObjectId() } as ReportInput);
  const [created] = await executor(exec).insert(reports).values(row).returning();
  return toReportApi(created);
};

/**
 * Upsert keyed on `(user, startDate, endDate)`, matching the
 * `findOneAndUpdate({ userId, startDate, endDate }, …, { upsert: true })` the
 * report generator performs.
 *
 * There is no unique index on that triple — the Mongo version had none either —
 * so this reproduces the read-then-write rather than using ON CONFLICT. Adding
 * the index would be a schema change beyond the migration's remit, but it is
 * the right follow-up: without it two concurrent generations for the same
 * period can both miss and both insert.
 */
export const upsertForPeriod = async (
  input: CreateReportInput,
  exec?: Executor,
): Promise<ReportApi> => {
  const owner = validId(input.userId);
  const run = executor(exec);

  const existing = owner
    ? one(
        await run
          .select()
          .from(reports)
          .where(
            and(
              eq(reports.userId, owner),
              eq(reports.startDate, input.startDate),
              eq(reports.endDate, input.endDate),
            ),
          ),
      )
    : null;

  if (existing) {
    const [updated] = await run
      .update(reports)
      .set(toReportUpdate(input))
      .where(eq(reports.id, existing.id))
      .returning();
    return toReportApi(updated);
  }

  const row = toReportRow({ ...input, id: input.id ?? newObjectId() } as ReportInput);
  const [created] = await run.insert(reports).values(row).returning();
  return toReportApi(created);
};

export const removeByUser = async (userId: string, exec?: Executor): Promise<number> => {
  const owner = validId(userId);
  if (!owner) return 0;
  const rows = await executor(exec)
    .delete(reports)
    .where(eq(reports.userId, owner))
    .returning();
  return rows.length;
};

// ---------------------------------------------------------------------------
// report_settings
// ---------------------------------------------------------------------------

export const findSettingByUser = async (
  userId: string,
  exec?: Executor,
): Promise<ReportSettingApi | null> => {
  const owner = validId(userId);
  if (!owner) return null;

  const rows = await executor(exec)
    .select()
    .from(reportSettings)
    .where(eq(reportSettings.userId, owner))
    .orderBy(asc(reportSettings.id));
  const row = one(rows);
  return row ? toReportSettingApi(row) : null;
};

/**
 * The three-field projection the auth flows return alongside a login.
 *
 * `findOne({ userId }, { _id: 1, frequency: 1, isEnabled: 1 }).lean()` — the
 * projection is part of the response contract, not an optimisation, so it is a
 * separate function rather than a `findSettingByUser` the caller trims. Widening
 * it would add fields to every login, verify-OTP and refresh payload.
 */
export interface ReportSettingSummary {
  _id: string;
  frequency: string;
  isEnabled: boolean;
}

export const findSettingSummaryByUser = async (
  userId: string,
  exec?: Executor,
): Promise<ReportSettingSummary | null> => {
  const owner = validId(userId);
  if (!owner) return null;

  const rows = await executor(exec)
    .select({
      _id: reportSettings.id,
      frequency: reportSettings.frequency,
      isEnabled: reportSettings.isEnabled,
    })
    .from(reportSettings)
    .where(eq(reportSettings.userId, owner))
    .orderBy(asc(reportSettings.id));

  return one(rows);
};

/**
 * Enabled settings whose next report is due.
 *
 * Hits the partial index on `next_report_date WHERE is_enabled = true`.
 */
export const findDueSettings = async (
  now: Date,
  exec?: Executor,
): Promise<ReportSettingApi[]> =>
  toReportSettingApiList(
    await executor(exec)
      .select()
      .from(reportSettings)
      .where(
        and(eq(reportSettings.isEnabled, true), lte(reportSettings.nextReportDate, now)),
      )
      .orderBy(asc(reportSettings.id)),
  );

export type CreateReportSettingInput = Omit<ReportSettingInput, "id"> & { id?: string };

/**
 * Creates the user's setting, or returns the existing one.
 *
 * `ON CONFLICT (user_id) DO NOTHING` against the unique index added in migration
 * 0003, rather than trusting the caller's read-then-insert guard.
 * `createDefaultReportSetting` reads first and inserts if it found nothing, which
 * two concurrent verify-OTP or Google sign-ins can both pass under READ
 * COMMITTED — before the index that silently produced two rows, and with the
 * index it would produce a unique violation and fail one of the two sign-ins.
 *
 * Doing nothing on conflict and reading the winner back means the loser gets the
 * row that won instead of an error, which is what both callers actually want:
 * they need A setting to exist, not to be the one who created it.
 */
export const createSetting = async (
  input: CreateReportSettingInput,
  exec?: Executor,
): Promise<ReportSettingApi> => {
  const row = toReportSettingRow({
    ...input,
    id: input.id ?? newObjectId(),
  } as ReportSettingInput);

  const [created] = await executor(exec)
    .insert(reportSettings)
    .values(row)
    .onConflictDoNothing({ target: reportSettings.userId })
    .returning();

  if (created) return toReportSettingApi(created);

  // Lost the race: the concurrent insert committed first, so read its row.
  const existing = await findSettingByUser(row.userId, exec);
  if (existing) return existing;

  // Neither inserted nor present — the only way here is the row being deleted
  // between the conflict and this read, which means the user is gone too.
  throw new Error(`report setting for user ${row.userId} could not be created`);
};

/**
 * Updates ONE setting row, by id.
 *
 * The cron holds the exact row it read from `findDueSettings`, and mongoose's
 * `updateOne({ _id: setting._id })` touched only that one. `user_id` is
 * deliberately non-unique here (matching mongoose), so a by-user update is not
 * an equivalent statement — see the note on `updateSetting`.
 */
export const updateSettingById = async (
  id: string,
  patch: Partial<ReportSettingInput>,
  exec?: Executor,
): Promise<ReportSettingApi | null> => {
  const key = validId(id);
  if (!key) return null;

  const values = toReportSettingUpdate(patch);
  if (Object.keys(values).length === 0) {
    const rows = await executor(exec)
      .select()
      .from(reportSettings)
      .where(eq(reportSettings.id, key));
    const existing = one(rows);
    return existing ? toReportSettingApi(existing) : null;
  }

  const [row] = await executor(exec)
    .update(reportSettings)
    .set(values)
    .where(eq(reportSettings.id, key))
    .returning();
  return row ? toReportSettingApi(row) : null;
};

/**
 * Updates a user's setting.
 *
 * Scoped to a SINGLE row, not to every row sharing the user id. `user_id` is
 * deliberately left non-unique to match mongoose, and mongoose's
 * `findOne({ userId })` + `save()` wrote exactly one document — the first by id.
 * A bare `WHERE user_id = $1` would instead rewrite every duplicate, which is
 * reachable: `createDefaultReportSetting` guards with a read-then-insert that two
 * concurrent verify-OTP or Google sign-ins can both pass under READ COMMITTED.
 *
 * Resolving the id first and updating by primary key keeps the one-row guarantee
 * without depending on a constraint the schema does not yet have. The unique
 * index on `user_id` remains the right follow-up; this is correct either way.
 */
export const updateSetting = async (
  userId: string,
  patch: Partial<ReportSettingInput>,
  exec?: Executor,
): Promise<ReportSettingApi | null> => {
  const owner = validId(userId);
  if (!owner) return null;

  const existing = await findSettingByUser(owner, exec);
  if (!existing) return null;

  return updateSettingById(existing._id, patch, exec);
};

export const removeSettingsByUser = async (
  userId: string,
  exec?: Executor,
): Promise<number> => {
  const owner = validId(userId);
  if (!owner) return 0;
  const rows = await executor(exec)
    .delete(reportSettings)
    .where(eq(reportSettings.userId, owner))
    .returning();
  return rows.length;
};
