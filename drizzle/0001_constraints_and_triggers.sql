-- Constraints and triggers that reproduce mongoose schema behaviour which
-- drizzle-kit cannot express in the table definitions.
--
-- Everything here existed under Mongo. Without it the Postgres schema is
-- strictly more permissive than the one it replaces, and "same functionality"
-- would quietly stop being true at the data layer.

-- ---------------------------------------------------------------------------
-- updated_at
--
-- `timestamps: true` had mongoose stamp updatedAt on every write, outside the
-- caller's control. A column DEFAULT only fires on INSERT, so without this
-- trigger updated_at would freeze at creation time on every UPDATE and the
-- report/currency cron freshness checks would silently misbehave.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER transactions_set_updated_at BEFORE UPDATE ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER budgets_set_updated_at BEFORE UPDATE ON "budgets"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON "categories"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER reports_set_updated_at BEFORE UPDATE ON "reports"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER report_settings_set_updated_at BEFORE UPDATE ON "report_settings"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER exchange_rate_cache_set_updated_at BEFORE UPDATE ON "exchange_rate_cache"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER supported_currency_cache_set_updated_at BEFORE UPDATE ON "supported_currency_cache"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Identifier format
--
-- The primary keys are char(24), and char is BLANK-PADDED in Postgres: writing
-- a 5-character string stores it padded to 24 and it compares equal to itself
-- with trailing spaces. That would let a malformed id in silently and, worse,
-- make it match. These checks make the ObjectId format an invariant of the
-- database rather than a convention the application is trusted to follow.
-- ---------------------------------------------------------------------------
ALTER TABLE "users" ADD CONSTRAINT "users_id_objectid_format"
  CHECK (id ~ '^[0-9a-f]{24}$');--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_id_objectid_format"
  CHECK (id ~ '^[0-9a-f]{24}$');--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_objectid_format"
  CHECK (user_id ~ '^[0-9a-f]{24}$');--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_id_objectid_format"
  CHECK (id ~ '^[0-9a-f]{24}$');--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_id_objectid_format"
  CHECK (id ~ '^[0-9a-f]{24}$');--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_id_objectid_format"
  CHECK (id ~ '^[0-9a-f]{24}$');--> statement-breakpoint
ALTER TABLE "report_settings" ADD CONSTRAINT "report_settings_id_objectid_format"
  CHECK (id ~ '^[0-9a-f]{24}$');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Enums
--
-- Mongoose rejected an out-of-range value on every one of these paths. Modelled
-- as CHECK constraints rather than Postgres ENUM types on purpose: adding a
-- value to a native enum requires ALTER TYPE, which historically could not run
-- inside a transaction, whereas a CHECK is edited with an ordinary migration.
-- The value lists mirror the enums in src/models/.
-- ---------------------------------------------------------------------------
ALTER TABLE "users" ADD CONSTRAINT "users_provider_check"
  CHECK (provider IN ('local', 'google'));--> statement-breakpoint

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_type_check"
  CHECK (type IN ('INCOME', 'EXPENSE'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_status_check"
  CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payment_method_check"
  CHECK (payment_method IN ('CARD', 'BANK_TRANSFER', 'MOBILE_PAYMENT', 'AUTO_DEBIT', 'CASH', 'OTHER'));--> statement-breakpoint
-- Nullable: mongoose declared `default: null` alongside the enum, so null is a
-- legal value and every non-recurring transaction holds it.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_interval_check"
  CHECK (recurring_interval IS NULL OR recurring_interval IN ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_rate_source_check"
  CHECK (rate_source IS NULL OR rate_source IN ('live', 'cached'));--> statement-breakpoint

ALTER TABLE "reports" ADD CONSTRAINT "reports_status_check"
  CHECK (status IN ('SENT', 'PENDING', 'FAILED', 'NO_ACTIVITY'));--> statement-breakpoint
ALTER TABLE "report_settings" ADD CONSTRAINT "report_settings_frequency_check"
  CHECK (frequency IN ('MONTHLY'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Value ranges
--
-- `min: 1, max: 12` on the mongoose budget month path.
-- ---------------------------------------------------------------------------
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_month_check"
  CHECK (month BETWEEN 1 AND 12);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Normalisation
--
-- `uppercase: true` on the currency paths and `lowercase: true` on the email
-- path. The mappers normalise on write; these assert the mappers are actually
-- doing it, so a raw SQL write or a missed code path fails loudly instead of
-- producing a row that lookups can never find.
-- ---------------------------------------------------------------------------
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase"
  CHECK (email = lower(email));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_base_currency_uppercase"
  CHECK (base_currency = upper(base_currency));--> statement-breakpoint
ALTER TABLE "exchange_rate_cache" ADD CONSTRAINT "exchange_rate_cache_currencies_uppercase"
  CHECK (from_currency = upper(from_currency) AND to_currency = upper(to_currency));--> statement-breakpoint
ALTER TABLE "supported_currency_cache" ADD CONSTRAINT "supported_currency_cache_code_uppercase"
  CHECK (code = upper(code));
