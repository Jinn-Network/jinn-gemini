-- ============================================================================
-- Real-time notification triggers for Ponder database
-- ============================================================================
-- This script creates PostgreSQL triggers that use LISTEN/NOTIFY to broadcast
-- changes to the SSE realtime server. Each trigger fires on INSERT/UPDATE
-- and sends a notification with the operation type and affected row ID.
-- ============================================================================

-- Function to notify on request changes
CREATE OR REPLACE FUNCTION notify_request_changes()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'request_changes',
    json_build_object(
      'operation', TG_OP,
      'id', COALESCE(NEW.id, OLD.id),
      'table', 'request'
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for request table
DROP TRIGGER IF EXISTS request_changes_trigger ON "request";
CREATE TRIGGER request_changes_trigger
AFTER INSERT OR UPDATE ON "request"
FOR EACH ROW
EXECUTE FUNCTION notify_request_changes();

-- Function to notify on artifact changes
CREATE OR REPLACE FUNCTION notify_artifact_changes()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'artifact_changes',
    json_build_object(
      'operation', TG_OP,
      'id', NEW.id,
      'requestId', NEW."requestId",
      'topic', NEW.topic,
      'table', 'artifact'
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for artifact table
DROP TRIGGER IF EXISTS artifact_changes_trigger ON "artifact";
CREATE TRIGGER artifact_changes_trigger
AFTER INSERT OR UPDATE ON "artifact"
FOR EACH ROW
EXECUTE FUNCTION notify_artifact_changes();

-- Function to notify on delivery changes
CREATE OR REPLACE FUNCTION notify_delivery_changes()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'delivery_changes',
    json_build_object(
      'operation', TG_OP,
      'id', NEW.id,
      'requestId', NEW."requestId",
      'table', 'delivery'
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for delivery table
DROP TRIGGER IF EXISTS delivery_changes_trigger ON "delivery";
CREATE TRIGGER delivery_changes_trigger
AFTER INSERT ON "delivery"
FOR EACH ROW
EXECUTE FUNCTION notify_delivery_changes();

-- Function to notify on jobDefinition changes
CREATE OR REPLACE FUNCTION notify_job_definition_changes()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'job_definition_changes',
    json_build_object(
      'operation', TG_OP,
      'id', COALESCE(NEW.id, OLD.id),
      'lastStatus', NEW."lastStatus",
      'table', 'jobDefinition'
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for jobDefinition table
DROP TRIGGER IF EXISTS job_definition_changes_trigger ON "jobDefinition";
CREATE TRIGGER job_definition_changes_trigger
AFTER INSERT OR UPDATE ON "jobDefinition"
FOR EACH ROW
EXECUTE FUNCTION notify_job_definition_changes();

-- Verification query (run manually to test)
-- SELECT 'Triggers installed successfully' AS status;

