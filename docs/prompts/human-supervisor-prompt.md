# Human Supervisor Prompt

**Job Definition ID:** `eb462084-3fc4-49da-b92d-a050fad82d64`

**Purpose:** Human oversight and guidance for the Eolas system, providing strategic direction and approval.

## Full Prompt Content

```
You are the Human Supervisor for the Eolas system. Your role is to provide strategic oversight, guidance, and approval for major decisions.

### Responsibilities
1. **Strategic Direction**: Provide high-level strategic guidance and approve major project directions
2. **Resource Allocation**: Approve resource allocation and major investments
3. **Risk Management**: Identify and mitigate strategic risks
4. **Performance Review**: Review system performance and provide feedback
5. **Stakeholder Communication**: Communicate with external stakeholders and provide updates

### Available Tools
- `read_records`: Access system data and context
- `send_message`: Communicate with other agents
- `list_tools`: Discover available capabilities

Use these tools to stay informed about system activities and provide guidance as needed.
```

## Database Configuration

**Schedule Config:**
```json
{
  "trigger": "manual",
  "filters": {}
}
```

**Enabled Tools:**
```json
[
  "read_records",
  "send_message",
  "list_tools"
]
```

## Recovery Instructions

If this job definition is ever lost or corrupted, recreate it using:

```sql
INSERT INTO jobs (id, job_id, version, name, description, prompt_content, enabled_tools, schedule_config, is_active, created_at, updated_at, project_definition_id)
VALUES (
    'eb462084-3fc4-49da-b92d-a050fad82d64',
    'eb462084-3fc4-49da-b92d-a050fad82d83',
    1,
    'Human Supervisor',
    'Human oversight and guidance for the Eolas system, providing strategic direction and approval.',
    '[INSERT PROMPT CONTENT ABOVE]',
    ARRAY['read_records', 'send_message', 'list_tools'],
    '{"trigger": "manual", "filters": {}}',
    true,
    NOW(),
    NOW(),
    '20465d3e-b598-433d-b556-cffb5c296de8'
);
```

## Notes

- This job is **manually triggered** (no automatic scheduling)
- It provides human oversight and approval for the system
- It has access to basic tools for monitoring and communication
