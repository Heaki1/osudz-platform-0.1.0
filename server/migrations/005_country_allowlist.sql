-- 005_country_allowlist.sql — the countries whose players may submit and vote.
--
-- docs/todo.txt C4: my_plan.txt:741 says "allowed countries", plural and
-- administrator-configurable. The code has one constant instead — ELIGIBLE_COUNTRY
-- = 'DZ' in server/src/repo/users.ts — and the admin Eligibility tab renders a
-- hardcoded country list whose toggles save nothing.
--
-- THE SEED ROW IS LOAD-BEARING. isEligible reads this table once C4 is wired, so a
-- table with no rows refuses every account, the owner's included. Seeding DZ means
-- applying this migration changes nothing: the allowlist starts out saying exactly
-- what the constant said.
--
-- country is char(2) to match users.country_code, and Postgres blank-pads char, so
-- reads trim on both sides of the comparison exactly as isEligible already does.
--
-- Do not add BEGIN/COMMIT — the runner wraps each file in one transaction.

CREATE TABLE allowed_countries (
  country  char(2)     PRIMARY KEY,
  enabled  boolean     NOT NULL DEFAULT true,
  added_by integer     REFERENCES users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE allowed_countries IS 'repo/users.ts: replaces the ELIGIBLE_COUNTRY constant. A row with enabled = false is kept rather than deleted — it records that an administrator considered the country and refused it, which an absent row does not.';
COMMENT ON COLUMN allowed_countries.country IS 'ISO 3166-1 alpha-2, compared against users.country_code. char(2) is blank-padded, so reads trim.';
COMMENT ON COLUMN allowed_countries.added_by IS 'Who enabled it. ON DELETE SET NULL — losing an administrator''s account must not remove the country.';

-- The community this platform was built for. Without this row the allowlist refuses
-- everybody the moment C4 is wired.
INSERT INTO allowed_countries (country, enabled) VALUES ('DZ', true);
