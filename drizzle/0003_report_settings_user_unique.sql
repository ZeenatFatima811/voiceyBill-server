-- report_settings gets one row per user, enforced by the database.
--
-- Mongoose declared no unique index here, so the MongoDB -> Postgres migration
-- deliberately shipped without one: adding it there would have been a behaviour
-- change smuggled into a port whose whole point was changing nothing. This is
-- that change, made on purpose and on its own.
--
-- Why it matters: every code path already treats this as one-setting-per-user,
-- but nothing enforced it. `createDefaultReportSetting` guards with a
-- read-then-insert, and two concurrent verify-OTP or Google sign-ins can both
-- pass that guard under READ COMMITTED — leaving two rows and no rule about
-- which one wins. `updateSetting` then had to resolve an id first rather than
-- writing `where user_id = $1`, because that statement would rewrite both.
--
-- `createSetting` upserts against this index, so the race now resolves to a
-- single row with BOTH callers succeeding rather than one of them getting a
-- unique violation.

-- Collapse any pre-existing duplicates before the constraint goes on, keeping
-- the LOWEST id per user. Not hypothetical housekeeping: creating a unique index
-- on a column that already holds duplicates fails outright, which would leave
-- the migration half-applied on exactly the databases most likely to have them.
--
-- The lowest id is the row the application already treated as canonical —
-- `findSettingByUser` reads `order by id asc` and takes the first — so this
-- preserves the setting users were actually seeing and discards the shadow rows
-- that no code path could reach. Ids are ObjectId-format and k-sortable by
-- creation time, so the lowest id is also the oldest.
DELETE FROM "report_settings"
 WHERE "id" NOT IN (
   SELECT MIN("id") FROM "report_settings" GROUP BY "user_id"
 );--> statement-breakpoint

DROP INDEX "report_settings_user_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "report_settings_user_id_key" ON "report_settings" USING btree ("user_id");
