# Main Project Definition

**Project Definition ID:** `20465d3e-b598-433d-b556-cffb5c296de8`

**Purpose:** The core project definition for the Eolas system, defining the primary objective of achieving $100M market cap.

## Project Details

**Name:** Eolas Growth to $100M Market Cap

**Objective:** Grow the value of Eolas beyond a $100M market capitalization through product-led growth, market expansion, and monetization optimization.

**Strategy:** Focus on user acquisition, retention improvement, new market entry, and monetization strategy to achieve sustainable growth.

**KPIs:**
```json
{
  "north_star": "Market Cap: $100M",
  "metrics": [
    {
      "name": "Market Cap",
      "target": "$100M",
      "direction": "up"
    },
    {
      "name": "Monthly Active Users",
      "target": "10% QoQ growth",
      "direction": "up"
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
    'Eolas Growth to $100M Market Cap',
    'Grow the value of Eolas beyond a $100M market capitalization through product-led growth, market expansion, and monetization optimization.',
    'Focus on user acquisition, retention improvement, new market entry, and monetization strategy to achieve sustainable growth.',
    '{"north_star": "Market Cap: $100M", "metrics": [{"name": "Market Cap", "target": "$100M", "direction": "up"}, {"name": "Monthly Active Users", "target": "10% QoQ growth", "direction": "up"}]}',
    NOW(),
    NOW()
);
```

## Notes

- This is the **root project** for the entire Eolas system
- All other projects and jobs should be created under this umbrella
- The objective focuses on **sustainable growth** through multiple strategies
- KPIs are designed to be **measurable and actionable**
