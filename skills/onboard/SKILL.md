---
name: onboard
description: Browse available Jinn ventures and configure your worker to join one. Lists active ventures with token/staking details and sets WORKSTREAM_FILTER in .env.
allowed-tools: venture_query
user-invocable: true
emoji: "\U0001F680"
---

# Onboard to a Venture

Help users browse active Jinn ventures and configure their worker to participate.

## Flow

1. **List ventures**: Call `venture_query` with `{ "mode": "list", "status": "active" }` to fetch all active ventures.

2. **Present ventures as cards**: For each venture, show:
   - **Name** and description
   - **Token**: `$TOKEN_SYMBOL` if `token_symbol` is set, or "No token" otherwise
   - **Staking**: Show `staking_contract_address` if set, or "Shared Jinn staking contract" as default
   - **Workstream ID**: `root_workstream_id` (needed for worker config)
   - **Status**: active/paused
   - **Pool**: Link to pool if `pool_address` is set

3. **Ask user to pick a venture** from the list.

4. **Configure the worker**: Read the `.env` file at the project root. Set or update:
   ```
   WORKSTREAM_FILTER=<selected venture's root_workstream_id>
   ```
   If `WORKSTREAM_FILTER` already exists, replace its value. If not, append it.

5. **Show next steps**:
   - Run `yarn dev:mech` to start processing jobs for the selected venture
   - If the venture has a token, mention that completed jobs earn token rewards
   - Link to the venture's explorer page if root_workstream_id is available: `https://explorer.jinn.network/ventures/<root_workstream_id>`

6. **Warn** if the selected venture has no `root_workstream_id` — it hasn't been launched as a workstream yet and the worker cannot process jobs for it.

## Important Notes

- Only show ventures with status "active"
- Ventures without `root_workstream_id` cannot be joined yet
- The shared Jinn staking contract is `0x0dfaFbf570e9E813507aAE18aA08dFbA0aBc5139`
- Workers need 5,000 OLAS staked to earn OLAS rewards
- Venture token rewards (if available) are distributed separately via the distribution script
