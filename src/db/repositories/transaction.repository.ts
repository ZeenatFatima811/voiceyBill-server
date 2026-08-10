/**
 * transactions repository.
 *
 * The busiest table: list/filter/paginate, the budget-validated create, the
 * recurring cron, bulk import, bulk delete and the category-rename cascade.
 *
 * Two translations here deserve attention because they are where a subtle
 * behaviour change is most likely to slip in — the keyword search and the
 * category cascade. Both used case-insensitive REGEX under Mongo, which
 * Postgres has no direct equivalent for; see the notes at each.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  toTransactionApi,
  toTransactionApiList,
  toTransactionRow,
  toTransactionUpdate,
  type TransactionApi,
  type TransactionInput,
} from "../mappers/transaction.mapper";
import { newObjectId, toObjectId } from "../object-id";
import { transactions } from "../schema/transactions";
import { executor, type Executor } from "../unit-of-work";

const one = <T>(rows: T[]): T | null => rows[0] ?? null;
const validId = (id: string): string | null => toObjectId(id);

/**
 * Escapes a user-supplied string for use inside a LIKE/ILIKE pattern.
 *
 * The Mongo implementation escaped regex metacharacters (PR #166, after a
 * search-injection fix). The equivalent hazard here is different but real: `%`
 * and `_` are ILIKE wildcards, and a backslash escapes them. Without this, a
 * search for "50%" matches every row beginning "50".
 *
 * A search for ".*" must return zero matches rather than everything, which it
 * does here because ILIKE treats those characters as literals.
 */
const escapeLikePattern = (value: string): string =>
  value.replace(/([\\%_])/g, "\\$1");

export interface TransactionFilter {
  userId?: string;
  keyword?: string;
  type?: string;
  recurringStatus?: "RECURRING" | "NON_RECURRING";
  startDate?: Date;
  endDate?: Date;
  ids?: string[];
  /** Excluded from the result — the transaction being updated. */
  excludeId?: string;
  /**
   * Which column the date range applies to.
   *
   * `date` (the default) is what the budget validation, the report aggregation
   * and the analytics ranges all use.
   *
   * `dateOrCreatedAt` reproduces the LIST endpoint's filter, which is an OR
   * across two columns:
   *
   *   $or: [ { $and: [date >= start, date <= end] },
   *          { $and: [createdAt >= start, createdAt <= end] } ]
   *
   * so a transaction matches if EITHER its `date` or its `createdAt` falls in
   * the window. Backdated rows entered during the period are why. Applying the
   * plain `date` filter there would silently drop them from the list.
   */
  dateField?: "date" | "dateOrCreatedAt";
}

const buildWhere = (filter: TransactionFilter): SQL | undefined => {
  const clauses: (SQL | undefined)[] = [];

  if (filter.userId) {
    const key = validId(filter.userId);
    // An unparseable id must match nothing rather than everything — dropping
    // the clause would return another user's rows.
    clauses.push(key ? eq(transactions.userId, key) : sql`false`);
  }

  if (filter.keyword) {
    const pattern = `%${escapeLikePattern(filter.keyword)}%`;
    /**
     * Mongo searched title OR category with `$options: "i"`. ILIKE is the
     * case-insensitive equivalent for a literal substring, which is all the
     * original pattern was once escaped.
     */
    clauses.push(
      or(ilike(transactions.title, pattern), ilike(transactions.category, pattern)),
    );
  }

  if (filter.type) clauses.push(eq(transactions.type, filter.type));

  if (filter.recurringStatus) {
    clauses.push(eq(transactions.isRecurring, filter.recurringStatus === "RECURRING"));
  }

  // $gte / $lte — inclusive at both ends, matching the boundary fixtures.
  if (filter.startDate || filter.endDate) {
    const inRange = (column: typeof transactions.date) => {
      const bounds: SQL[] = [];
      if (filter.startDate) bounds.push(gte(column, filter.startDate));
      if (filter.endDate) bounds.push(lte(column, filter.endDate));
      return bounds.length > 1 ? and(...bounds) : bounds[0];
    };

    clauses.push(
      filter.dateField === "dateOrCreatedAt"
        ? or(inRange(transactions.date), inRange(transactions.createdAt))
        : inRange(transactions.date),
    );
  }

  if (filter.excludeId) {
    const key = validId(filter.excludeId);
    // An unparseable id excludes nothing, exactly as `$ne` against a
    // non-matching value did.
    if (key) clauses.push(ne(transactions.id, key));
  }

  if (filter.ids) {
    const keys = filter.ids.map(validId).filter((key): key is string => key !== null);
    clauses.push(keys.length ? inArray(transactions.id, keys) : sql`false`);
  }

  const defined = clauses.filter((clause): clause is SQL => Boolean(clause));
  return defined.length ? and(...defined) : undefined;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListOptions {
  skip?: number;
  limit?: number;
  /** Defaults to `createdAt desc`, matching the list query's `sort`. */
  sort?: "createdAtDesc" | "dateAsc";
}

export const list = async (
  filter: TransactionFilter,
  options: ListOptions = {},
  exec?: Executor,
): Promise<TransactionApi[]> => {
  const where = buildWhere(filter);

  const orderBy =
    options.sort === "dateAsc"
      ? [asc(transactions.date), asc(transactions.title), asc(transactions.id)]
      : // `_id` breaks ties so pagination cannot repeat or skip a row when two
        // transactions share a createdAt — Mongo left that unspecified.
        [desc(transactions.createdAt), desc(transactions.id)];

  const query = executor(exec).select().from(transactions).where(where).orderBy(...orderBy);

  if (options.limit !== undefined) query.limit(options.limit);
  if (options.skip !== undefined) query.offset(options.skip);

  return toTransactionApiList(await query);
};

export const countAll = async (
  filter: TransactionFilter,
  exec?: Executor,
): Promise<number> => {
  const [row] = await executor(exec)
    .select({ value: count() })
    .from(transactions)
    .where(buildWhere(filter));
  return row?.value ?? 0;
};

export const findById = async (
  id: string,
  userId?: string,
  exec?: Executor,
): Promise<TransactionApi | null> => {
  const key = validId(id);
  if (!key) return null;

  const clauses: SQL[] = [eq(transactions.id, key)];
  if (userId) {
    const owner = validId(userId);
    if (!owner) return null;
    clauses.push(eq(transactions.userId, owner));
  }

  const rows = await executor(exec)
    .select()
    .from(transactions)
    .where(and(...clauses));
  const row = one(rows);
  return row ? toTransactionApi(row) : null;
};

/**
 * Recurring rows that are due.
 *
 * Hits the partial index on `next_recurring_date WHERE is_recurring = true`,
 * so this stays an index scan rather than the full-collection scan the Mongo
 * version performed before its partial index was added.
 */
export const findDueRecurring = async (
  now: Date,
  exec?: Executor,
): Promise<TransactionApi[]> =>
  toTransactionApiList(
    await executor(exec)
      .select()
      .from(transactions)
      .where(and(eq(transactions.isRecurring, true), lte(transactions.nextRecurringDate, now)))
      .orderBy(asc(transactions.id)),
  );

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type CreateTransactionInput = Omit<TransactionInput, "id"> & { id?: string };

export const create = async (
  input: CreateTransactionInput,
  exec?: Executor,
): Promise<TransactionApi> => {
  const row = toTransactionRow({ ...input, id: input.id ?? newObjectId() });
  const [created] = await executor(exec).insert(transactions).values(row).returning();
  return toTransactionApi(created);
};

/** Bulk insert — the `bulkWrite` path used by import and the seed. */
export const createMany = async (
  inputs: CreateTransactionInput[],
  exec?: Executor,
): Promise<TransactionApi[]> => {
  if (inputs.length === 0) return [];
  const rows = inputs.map((input) =>
    toTransactionRow({ ...input, id: input.id ?? newObjectId() }),
  );
  return toTransactionApiList(
    await executor(exec).insert(transactions).values(rows).returning(),
  );
};

export const update = async (
  id: string,
  patch: Partial<TransactionInput>,
  userId?: string,
  exec?: Executor,
): Promise<TransactionApi | null> => {
  const key = validId(id);
  if (!key) return null;

  const values = toTransactionUpdate(patch);
  if (Object.keys(values).length === 0) return findById(key, userId, exec);

  const clauses: SQL[] = [eq(transactions.id, key)];
  if (userId) {
    const owner = validId(userId);
    if (!owner) return null;
    clauses.push(eq(transactions.userId, owner));
  }

  const [row] = await executor(exec)
    .update(transactions)
    .set(values)
    .where(and(...clauses))
    .returning();
  return row ? toTransactionApi(row) : null;
};

export const remove = async (
  id: string,
  userId?: string,
  exec?: Executor,
): Promise<TransactionApi | null> => {
  const key = validId(id);
  if (!key) return null;

  const clauses: SQL[] = [eq(transactions.id, key)];
  if (userId) {
    const owner = validId(userId);
    if (!owner) return null;
    clauses.push(eq(transactions.userId, owner));
  }

  const [row] = await executor(exec)
    .delete(transactions)
    .where(and(...clauses))
    .returning();
  return row ? toTransactionApi(row) : null;
};

export const removeMany = async (
  filter: TransactionFilter,
  exec?: Executor,
): Promise<number> => {
  const where = buildWhere(filter);
  // Refuse an unfiltered delete: `deleteMany({})` would empty the table.
  if (!where) return 0;
  const rows = await executor(exec).delete(transactions).where(where).returning();
  return rows.length;
};

/**
 * Renames a category across a user's transactions.
 *
 * Mongo matched with `{ $regex: new RegExp('^' + name + '$', 'i') }` — an
 * anchored, case-insensitive EXACT match, not a substring one. `lower(x) =
 * lower(y)` is the faithful translation; using ILIKE without anchors would also
 * rewrite "Fast Food" when renaming "Food".
 *
 * Both halves matter:
 * halves: "Food" and "food" rows must both move, and another user's "Food"
 * rows must not.
 */
export const renameCategory = async (
  userId: string,
  fromName: string,
  toName: string,
  exec?: Executor,
): Promise<number> => {
  const owner = validId(userId);
  if (!owner) return 0;

  const rows = await executor(exec)
    .update(transactions)
    // `updatedAt` is set explicitly because this bypasses the mapper. Without
    // it the trigger stamps the DATABASE clock, diverging from every other
    // write on the table — see drizzle/0002_app_clock_timestamps.sql.
    .set({ category: toName, updatedAt: new Date() })
    .where(
      and(
        eq(transactions.userId, owner),
        sql`lower(${transactions.category}) = lower(${fromName})`,
      ),
    )
    .returning();
  return rows.length;
};

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * The report aggregation, in the units the caller expects.
 *
 * Ports the `$facet` pipeline in `generateReportService`, which computed three
 * independent rollups over one `$match`. A facet is three correlated
 * subqueries in SQL, so it becomes three CTEs over a shared `scoped` set —
 * which is also what stops the source rows being scanned three times.
 *
 * Amounts stay in CENTS, exactly as the pipeline produced them: the caller
 * applies `convertToDollarUnit` itself and would double-convert otherwise.
 *
 * `$abs` is preserved. Nothing writes negative amounts today, but the original
 * summed absolute values and a stored negative would otherwise flip a total's
 * sign rather than adding to it.
 *
 * The date bounds are passed as ISO STRINGS with an explicit `::timestamptz`
 * cast, not as Date objects. A raw `sql` call carries no column type for the
 * driver to infer from, and postgres.js then rejects the value outright — "The
 * string argument must be of type string ... Received an instance of Date".
 * Every parameterised raw query in this file needs the same treatment.
 */
export interface ReportAggregate {
  /**
   * `undefined` when NO rows matched at all; a number when rows matched.
   *
   * The distinction is load-bearing, not incidental. `generateReportService`
   * returns null when `totalIncome === 0 && totalExpenses === 0`, and under
   * Mongo an empty `$facet` branch made `$arrayElemAt` yield undefined, so that
   * guard did NOT fire for a user with no transactions — it returned a
   * zero-filled report instead. It fired only when rows existed and genuinely
   * summed to zero.
   *
   * `sum()` over zero rows is NULL in SQL and 0 over rows that all contribute
   * zero, which reproduces exactly that split — hence no `coalesce` here.
   */
  totalIncome: number | undefined;
  totalExpenses: number | undefined;
  /** Lowercased category and its total, biggest first, capped at five. */
  categories: { _id: string; total: number }[];
  /** Distinct non-null original currencies, most frequent first. */
  currencySummary: { _id: string; count: number }[];
}

export const reportAggregate = async (
  userId: string,
  fromDate: Date,
  toDate: Date,
  exec?: Executor,
): Promise<ReportAggregate> => {
  const owner = validId(userId);
  const empty: ReportAggregate = {
    totalIncome: undefined,
    totalExpenses: undefined,
    categories: [],
    currencySummary: [],
  };
  if (!owner) return empty;

  const rows = (await executor(exec).execute(sql`
    with scoped as (
      select * from transactions
       where user_id = ${owner}
         and date >= ${fromDate.toISOString()}::timestamptz
         and date <= ${toDate.toISOString()}::timestamptz
    ),
    summary as (
      select
        sum(case when type = 'INCOME'  then abs(amount) else 0 end) as total_income,
        sum(case when type = 'EXPENSE' then abs(amount) else 0 end) as total_expenses
      from scoped
    ),
    by_category as (
      select lower(category) as id, sum(abs(amount)) as total
        from scoped
       where type = 'EXPENSE'
       group by lower(category)
       -- The category name breaks ties so the top-5 cutoff is deterministic.
       -- Mongo sorted by total alone and then took the first 5, so when a tie
       -- straddled the cutoff, WHICH rows survived varied between runs of
       -- identical code against identical data: a user with tied category
       -- totals saw their report top-5 change between months for no reason.
       order by total desc, lower(category) asc
       limit 5
    ),
    by_currency as (
      select original_currency as id, count(*)::int as count
        from scoped
       where original_currency is not null
       group by original_currency
       order by count desc, original_currency asc
    )
    select
      (select total_income   from summary) as total_income,
      (select total_expenses from summary) as total_expenses,
      (select coalesce(json_agg(json_build_object('_id', id, 'total', total)
                                order by total desc, id asc), '[]'::json)
         from by_category) as categories,
      (select coalesce(json_agg(json_build_object('_id', id, 'count', count)
                                order by count desc, id asc), '[]'::json)
         from by_currency) as currency_summary
  `)) as unknown as Record<string, unknown>[];

  const row = rows[0];
  if (!row) return empty;

  // `sum()` over bigint returns numeric, which the driver hands back as a
  // string; the totals are integer cents, so they are safely within Number.
  const asNumber = (value: unknown): number => Number(value ?? 0);

  return {
    // NULL (no matching rows) stays undefined; a real 0 stays 0.
    totalIncome: row.total_income === null ? undefined : asNumber(row.total_income),
    totalExpenses:
      row.total_expenses === null ? undefined : asNumber(row.total_expenses),
    categories: ((row.categories ?? []) as { _id: string; total: unknown }[]).map(
      (entry) => ({ _id: entry._id, total: asNumber(entry.total) }),
    ),
    currencySummary: ((row.currency_summary ?? []) as {
      _id: string;
      count: unknown;
    }[]).map((entry) => ({ _id: entry._id, count: asNumber(entry.count) })),
  };
};

/**
 * Analytics: totals for one date range.
 *
 * Ports the summary pipeline in `analytics.service.ts`. Returns null when NO
 * rows matched, mirroring `$group: { _id: null }` producing an empty array —
 * the caller's destructuring defaults depend on that, and a zero-filled object
 * would report "0 transactions" where the original reported nothing at all.
 *
 * Amounts stay in CENTS; the caller converts.
 */
export interface SummaryAggregate {
  totalIncome: number;
  totalExpenses: number;
  transactionCount: number;
}

export const summaryAggregate = async (
  userId: string,
  from?: Date | null,
  to?: Date | null,
  exec?: Executor,
): Promise<SummaryAggregate | null> => {
  const owner = validId(userId);
  if (!owner) return null;

  const clauses: SQL[] = [eq(transactions.userId, owner)];
  if (from && to) {
    clauses.push(gte(transactions.date, from), lte(transactions.date, to));
  }

  const [row] = await executor(exec)
    .select({
      totalIncome: sql<string>`coalesce(sum(case when ${transactions.type} = 'INCOME'  then abs(${transactions.amount}) else 0 end), 0)`,
      totalExpenses: sql<string>`coalesce(sum(case when ${transactions.type} = 'EXPENSE' then abs(${transactions.amount}) else 0 end), 0)`,
      transactionCount: count(),
    })
    .from(transactions)
    .where(and(...clauses));

  // `$group` emits no document when nothing matched; an aggregate with no
  // GROUP BY always emits one row, so the count is what distinguishes them.
  if (!row || Number(row.transactionCount) === 0) return null;

  return {
    totalIncome: Number(row.totalIncome),
    totalExpenses: Number(row.totalExpenses),
    transactionCount: Number(row.transactionCount),
  };
};

/**
 * Analytics: per-day income/expense series.
 *
 * `$dateToString: { format: "%Y-%m-%d" }` formats in UTC, so `to_char(... at
 * time zone 'UTC')` is the faithful equivalent. Using the server's local zone
 * would shift a transaction near midnight into the neighbouring day.
 */
export interface ChartPoint {
  date: string;
  income: number;
  expenses: number;
  incomeCount: number;
  expenseCount: number;
}

export const chartAggregate = async (
  userId: string,
  from?: Date | null,
  to?: Date | null,
  exec?: Executor,
): Promise<ChartPoint[]> => {
  const owner = validId(userId);
  if (!owner) return [];

  const clauses: SQL[] = [eq(transactions.userId, owner)];
  if (from && to) {
    clauses.push(gte(transactions.date, from), lte(transactions.date, to));
  }

  const day = sql<string>`to_char(${transactions.date} at time zone 'UTC', 'YYYY-MM-DD')`;

  const rows = await executor(exec)
    .select({
      date: day,
      income: sql<string>`coalesce(sum(case when ${transactions.type} = 'INCOME'  then abs(${transactions.amount}) else 0 end), 0)`,
      expenses: sql<string>`coalesce(sum(case when ${transactions.type} = 'EXPENSE' then abs(${transactions.amount}) else 0 end), 0)`,
      incomeCount: sql<string>`count(*) filter (where ${transactions.type} = 'INCOME')`,
      expenseCount: sql<string>`count(*) filter (where ${transactions.type} = 'EXPENSE')`,
    })
    .from(transactions)
    .where(and(...clauses))
    .groupBy(day)
    .orderBy(day);

  return rows.map((row) => ({
    date: row.date,
    income: Number(row.income),
    expenses: Number(row.expenses),
    incomeCount: Number(row.incomeCount),
    expenseCount: Number(row.expenseCount),
  }));
};

/**
 * Analytics: expense totals per category, lowercased.
 *
 * The top-three / "others" split that the `$facet` performed is left to the
 * caller — it is presentation logic, and doing it in SQL would need a second
 * pass for no gain. This returns every category, biggest first.
 */
export const expenseByCategory = async (
  userId: string,
  from?: Date | null,
  to?: Date | null,
  exec?: Executor,
): Promise<{ name: string; value: number }[]> => {
  const owner = validId(userId);
  if (!owner) return [];

  const clauses: SQL[] = [
    eq(transactions.userId, owner),
    eq(transactions.type, "EXPENSE"),
  ];
  if (from && to) {
    clauses.push(gte(transactions.date, from), lte(transactions.date, to));
  }

  const name = sql<string>`lower(${transactions.category})`;

  const rows = await executor(exec)
    .select({ name, value: sql<string>`sum(abs(${transactions.amount}))` })
    .from(transactions)
    .where(and(...clauses))
    .groupBy(name)
    .orderBy(sql`sum(abs(${transactions.amount})) desc`, name);

  return rows.map((row) => ({ name: row.name, value: Number(row.value) }));
};
