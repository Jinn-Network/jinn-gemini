# Main Project Definition

**Project Definition ID:** `20465d3e-b598-433d-b556-cffb5c296de8`

**Purpose:** The core project definition for the system, defining the primary objective of maximizing Buzz on Civitai.

## Project Details

**Name:** Civitai Buzz Maximization

**Objective:** To become a top content creator on Civitai by systematically generating high-engagement images, analyzing performance, and optimizing our strategy to earn the maximum amount of Buzz.

**Strategy:** Employ a continuous, data-driven cycle of experimentation. Delegate specialized tasks for image generation, posting, and performance analysis. Use insights from leading indicators (likes, comments, etc.) to refine models, prompts, and posting schedules to optimize for Buzz.

**KPIs:**
```json
{
  "north_star": "Total Buzz Earned",
  "metrics": [
    {
      "name": "Total Buzz Earned",
      "target": "10% WoW growth",
      "direction": "up"
    },
    {
      "name": "Engagement Rate (likes+comments per post)",
      "target": "5% WoW growth",
      "direction": "up"
    },
    {
      "name": "Cost per 100 Buzz",
      "direction": "down"
    }
  ]
}
```

## Recovery Instructions

If this project definition is ever lost or corrupted, recreate it using:

```sql
INSERT INTO project_definitions (id, name, objective, strategy, kpis, created_at, updated_at)
VALUES (
    '20465d3e-b598-433d-b556-cffb5c296de8',
    'Civitai Buzz Maximization',
    'To become a top content creator on Civitai by systematically generating high-engagement images, analyzing performance, and optimizing our strategy to earn the maximum amount of Buzz.',
    'Employ a continuous, data-driven cycle of experimentation. Delegate specialized tasks for image generation, posting, and performance analysis. Use insights from leading indicators (likes, comments, etc.) to refine models, prompts, and posting schedules to optimize for Buzz.',
    '{"north_star": "Total Buzz Earned", "metrics": [{"name": "Total Buzz Earned", "target": "10% WoW growth", "direction": "up"}, {"name": "Engagement Rate (likes+comments per post)", "target": "5% WoW growth", "direction": "up"}, {"name": "Cost per 100 Buzz", "direction": "down"}]}',
    NOW(),
    NOW()
);
```

## Notes

- This is the **root project** for the entire system.
- All other projects and jobs should be created under this umbrella.
- The objective focuses on **sustainable Buzz growth** through data-driven experimentation.
- KPIs are designed to be **measurable and actionable**.
