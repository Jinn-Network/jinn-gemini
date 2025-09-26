# Automated Job Reposting System

## Overview

The automated job reposting system monitors decomposition chains for completion and automatically reposts the original (root) job with enhanced context from all completed work. This enables continuous work decomposition and integration.

## How It Works

1. **Chain Detection**: The worker continuously monitors job definitions in the subgraph for completion
2. **Completion Check**: When all requests in a decomposition chain are delivered, the chain is considered complete
3. **Context Aggregation**: System builds comprehensive context including artifacts, deliveries, and metrics
4. **Automatic Reposting**: The root job is reposted with enhanced prompt containing decomposition results

## Configuration

### Environment Variables

- `ENABLE_AUTO_REPOST`: Enable/disable auto-reposting (default: `true`)
  - Set to `"false"` to disable the feature entirely
- `PONDER_GRAPHQL_URL`: Subgraph endpoint (default: `http://localhost:42069/graphql`)

### Configuration Constants

The following can be modified in `worker/mech_worker.ts`:

```typescript
const REPOSTING_CONFIG = {
  maxDecompositionDepth: 5,              // Max chain traversal depth
  minTimeBetweenReposts: 5 * 60 * 1000,  // 5 minutes between reposts
  chainCompletionTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours max chain age
  enableAutoRepost: true,                // Enable/disable feature
};
```

## Safety Mechanisms

### Loop Prevention
- **Recent Repost Tracking**: Prevents reposting the same job within the minimum interval
- **Decomposition Depth Limiting**: Prevents infinite traversal up job chains
- **Chain Age Timeout**: Ignores very old completed chains

### Memory Management
- **Cleanup Process**: Automatically cleans up tracking maps every hour
- **Configurable Timeouts**: All time-based limits are configurable

### Error Handling
- **Graceful Failures**: Errors in chain checking don't break main worker loop
- **Comprehensive Logging**: Debug and info logs for monitoring and troubleshooting
- **Subgraph Fallback**: Continues operation even if individual queries fail

## Monitoring and Debugging

### Log Levels

- **Info**: Major events (chain completion found, successful reposts)
- **Debug**: Detailed operation info (job checking, skipping due to timeouts)
- **Error**: Failures in chain checking or reposting
- **Warn**: Non-critical issues (max depth reached, old chains)

### Key Log Messages

```
# Normal operation
Found completed chain for root job Example Job, reposting...
Successfully reposted root job abc-123 (Example Job) after chain completion

# Safety mechanisms
Skipping root job Example Job (abc-123) - recently reposted  
Chain abc-123 is complete but too old (86400s), skipping repost

# Error conditions
Error checking chain completion for abc-123: [error details]
Cannot repost: root job definition not found: abc-123
```

## Enhanced Prompt Structure

When reposting, the system enhances the original prompt with:

```
[Original Prompt]

## DECOMPOSITION RESULTS SUMMARY
Previous work was decomposed into X sub-tasks.

### Completed Work:
- Artifact Name: topic
- Research Results: market-analysis

### Available Context:  
- Request 0x123: Available via IPFS QmHash123
- Request 0x456: Available via IPFS QmHash456

### Chain Metrics:
- Total Duration: 15 minutes
- Successful Requests: 3/3

### Next Steps:
Based on the completed decomposition work above, determine what needs to be done next...

Previous decomposition chain ID: abc-123
```

## Integration Points

### Worker Integration
- Runs in the main worker polling loop before job processing
- Uses existing subgraph query patterns
- Leverages mech-client-ts for reposting

### Subgraph Dependencies
- Requires `jobDefinitions` with `sourceJobDefinitionId` relationships
- Needs `requests` with delivery status tracking
- Uses `artifacts` and `deliveries` for context building

## Testing

Run the test suite to verify functionality:

```bash
npx tsx worker/auto-repost.test.ts
```

Tests cover:
- Repost logic and timing constraints
- Interface structure validation  
- Enhanced prompt generation
- Safety mechanism operation

## Disabling the Feature

To completely disable auto-reposting:

1. **Environment Variable**: `ENABLE_AUTO_REPOST=false`
2. **Or remove from worker loop**: Comment out the call in `main()`:
   ```typescript
   // await checkAndRepostCompletedChains();
   ```

## Performance Considerations

- **Polling Frequency**: Runs on every worker loop iteration
- **Query Optimization**: Uses efficient subgraph queries with limits
- **Memory Usage**: Cleanup process prevents unbounded memory growth
- **Error Recovery**: Non-blocking errors don't impact main worker operation

## Future Enhancements

Potential improvements for future versions:

- **Similarity Detection**: Prevent reposting very similar prompts
- **Chain-Specific Configuration**: Per-job-definition reposting settings
- **Advanced Context Filtering**: Selective artifact/delivery inclusion
- **Metrics Dashboard**: Visual monitoring of repost activities
- **Manual Override API**: Ability to force or prevent specific reposts