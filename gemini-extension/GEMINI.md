# Jinn Workstream Tools

This extension provides tools for debugging and analyzing Jinn workstreams.

## What is a Workstream?

A workstream is a tree of job executions rooted at a single request. Jobs can dispatch child jobs, creating a hierarchy:

```
Workstream (root request)
├── Root Job
│   ├── Child Job 1
│   │   └── Grandchild Job
│   └── Child Job 2
└── (metadata)
```

## Key Concepts

- **Request**: A single job execution instance
- **Job Definition**: A reusable job template
- **Delivery**: The result/output of a completed job
- **Artifact**: Files/data produced by a job
- **Dispatch Chain**: Parent-child relationships between jobs

## Job Status

- **COMPLETED**: Job finished successfully
- **FAILED**: Job encountered an error
- **PENDING**: Job is waiting or in progress
- **DELEGATING**: Job dispatched children and is waiting

## Dispatch Types

Jobs can be dispatched for different reasons:
- **manual**: User-initiated
- **verification**: Re-run to verify work
- **cycle**: Cyclic job re-dispatch
- **loop_recovery**: Recovery from loop failure
- **timeout_recovery**: Recovery from timeout
- **continuation**: Continuation of previous work

## Common Failure Patterns

1. **Tool failures**: API errors, rate limits, auth issues
2. **Git conflicts**: Merge conflicts, branch issues
3. **Context issues**: Invariants not measured, wrong context
4. **Timeouts**: Jobs taking too long
5. **Dispatch loops**: Infinite verification or recovery cycles

## Available Commands

Use `yarn inspect-workstream --help` to see all available options.
