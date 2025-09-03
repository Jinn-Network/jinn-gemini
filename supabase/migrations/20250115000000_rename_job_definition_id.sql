-- MIGRATION SCRIPT: RENAME job_definition_id TO parent_job_definition_id

BEGIN;

-- Step 1: Drop existing foreign key constraints that reference job_definition_id
ALTER TABLE "public"."artifacts" DROP CONSTRAINT "fk_artifacts_job_definition_id_jobs";
ALTER TABLE "public"."job_board" DROP CONSTRAINT "fk_job_board_job_definition_id";
ALTER TABLE "public"."job_reports" DROP CONSTRAINT "fk_job_reports_job_definition_id_jobs";
ALTER TABLE "public"."memories" DROP CONSTRAINT "fk_memories_job_definition_id_jobs";
ALTER TABLE "public"."messages" DROP CONSTRAINT "fk_messages_job_definition_id_jobs";

-- Step 2: Rename the columns
ALTER TABLE "public"."job_board" RENAME COLUMN "job_definition_id" TO "parent_job_definition_id";
ALTER TABLE "public"."artifacts" RENAME COLUMN "job_definition_id" TO "parent_job_definition_id";
ALTER TABLE "public"."job_reports" RENAME COLUMN "job_definition_id" TO "parent_job_definition_id";
ALTER TABLE "public"."memories" RENAME COLUMN "job_definition_id" TO "parent_job_definition_id";
ALTER TABLE "public"."messages" RENAME COLUMN "job_definition_id" TO "parent_job_definition_id";

-- Step 3: Recreate the foreign key constraints with the new column name
ALTER TABLE "public"."artifacts" ADD CONSTRAINT "fk_artifacts_parent_job_definition_id" FOREIGN KEY (parent_job_definition_id) REFERENCES "public"."jobs"(id);
ALTER TABLE "public"."job_board" ADD CONSTRAINT "fk_job_board_parent_job_definition_id" FOREIGN KEY (parent_job_definition_id) REFERENCES "public"."jobs"(id);
ALTER TABLE "public"."job_reports" ADD CONSTRAINT "fk_job_reports_parent_job_definition_id" FOREIGN KEY (parent_job_definition_id) REFERENCES "public"."jobs"(id);
ALTER TABLE "public"."memories" ADD CONSTRAINT "fk_memories_parent_job_definition_id" FOREIGN KEY (parent_job_definition_id) REFERENCES "public"."jobs"(id);
ALTER TABLE "public"."messages" ADD CONSTRAINT "fk_messages_parent_job_definition_id" FOREIGN KEY (parent_job_definition_id) REFERENCES "public"."jobs"(id);

-- Step 4: Rename existing indexes to match the new column names
ALTER INDEX "idx_job_board_job_definition_id" RENAME TO "idx_job_board_parent_job_definition_id";
ALTER INDEX "idx_artifacts_job_definition_id" RENAME TO "idx_artifacts_parent_job_definition_id";
ALTER INDEX "idx_job_reports_job_definition_id" RENAME TO "idx_job_reports_parent_job_definition_id";
ALTER INDEX "idx_memories_job_definition_id" RENAME TO "idx_memories_parent_job_definition_id";
ALTER INDEX "idx_messages_job_definition_id" RENAME TO "idx_messages_parent_job_definition_id";

-- Step 5: Add parent_job_definition_id to jobs table for delegation tracking
ALTER TABLE "public"."jobs" ADD COLUMN "parent_job_definition_id" UUID;
ALTER TABLE "public"."jobs" ADD CONSTRAINT "fk_jobs_parent_job_definition_id" FOREIGN KEY (parent_job_definition_id) REFERENCES "public"."jobs"(id);
CREATE INDEX "idx_jobs_parent_job_definition_id" ON "public"."jobs"(parent_job_definition_id);

-- Step 6: Add context columns to job_board table
ALTER TABLE "public"."job_board" ADD COLUMN "trigger_context" JSONB;
ALTER TABLE "public"."job_board" ADD COLUMN "delegated_work_context" JSONB;

COMMIT;
