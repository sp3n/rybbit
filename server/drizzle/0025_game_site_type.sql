-- sp3n/rybbit fork: allow the "game" site type. First shipped as
-- 0015_massive_the_spike before the fork took upstream's 0015-0024; renumbered
-- after them. Idempotent, so databases that already ran the old 0015 converge.
ALTER TABLE "sites" DROP CONSTRAINT IF EXISTS "sites_type_check";--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_type_check" CHECK ("sites"."type" IS NULL OR "sites"."type" IN ('web', 'mobile', 'game'));
