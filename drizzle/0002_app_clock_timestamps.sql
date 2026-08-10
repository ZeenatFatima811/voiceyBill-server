-- The application owns updated_at; the trigger is only a backstop.
--
-- `timestamps: true` had MONGOOSE stamp createdAt/updatedAt — in the
-- application process, from the JS clock. The Postgres equivalents were
-- defaulting to `now()`, which is the DATABASE server's clock. Two consequences,
-- one operational and one that broke the parity suite outright:
--
--   • The application lost control of a value it used to set. Serverless
--     instances and the database can drift, and `created_at` is what the
--     transaction list index orders by — mixing two clocks can reorder a user's
--     history across the boundary.
--
--   • The parity suite re-bases the process clock to run against fixed dates
--     (test/parity/support/clock.ts). Rows written through Postgres ignored it
--     and were stamped with real time, which showed up as `<anchor +52d 9h>`
--     where the Mongo capture had `<now 0m>`.
--
-- The repositories now supply both columns explicitly, matching mongoose. This
-- rewrites the trigger so an application-provided value WINS, while a raw SQL
-- update that leaves updated_at alone still gets stamped — so the backstop
-- survives without fighting the application for the column.
--
-- The INSERT defaults are left in place for the same reason: they only apply
-- when nothing supplies a value.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  -- Untouched by this statement -> stamp it. Explicitly set -> respect it.
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
