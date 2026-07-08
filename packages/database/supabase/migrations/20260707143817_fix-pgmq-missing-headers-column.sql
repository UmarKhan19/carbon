-- Fix: PGMQ queue tables created by an older pgmq (< 1.4.0) are missing the
-- `headers` column that the current pgmq.send / pgmq.send_batch functions write
-- to. On a database where the queue tables predate the pgmq upgrade this surfaces
-- at runtime as:
--
--   ERROR 42703: column "headers" of relation "q_event_system" does not exist
--
-- (triggered by dispatch_event_interceptors -> pgmq.send_batch('event_system', ...)
-- and by any other queue whose table was created before headers existed).
--
-- Add the `headers` column to every existing queue table (q_<name>) and its
-- archive table (a_<name>) when missing. Idempotent: ADD COLUMN IF NOT EXISTS is a
-- no-op on tables that already have it (e.g. queues created by pgmq >= 1.4.0), so
-- this is safe on both fresh and pre-upgrade databases and safe to re-run.

DO $$
DECLARE
  q record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgmq') THEN
    RETURN;
  END IF;

  FOR q IN SELECT queue_name FROM pgmq.list_queues() LOOP
    EXECUTE format(
      'ALTER TABLE IF EXISTS pgmq.%I ADD COLUMN IF NOT EXISTS headers JSONB',
      'q_' || q.queue_name
    );
    EXECUTE format(
      'ALTER TABLE IF EXISTS pgmq.%I ADD COLUMN IF NOT EXISTS headers JSONB',
      'a_' || q.queue_name
    );
  END LOOP;
END $$;
