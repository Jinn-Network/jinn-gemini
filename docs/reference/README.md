# Reference Documentation

Concise, LLM-friendly reference docs for common lookup needs.

These docs are designed to be:
- **Quick to scan** - Key information at a glance
- **Accurate** - Single source of truth
- **Referenced by skills** - Used as context for agent skills

---

## Available References

| Doc | Purpose |
|-----|---------|
| [TOOL_POLICY.md](./TOOL_POLICY.md) | Tool enablement hierarchy, meta-tools, UNAUTHORIZED_TOOLS errors |
| [DISPATCH_TYPES.md](./DISPATCH_TYPES.md) | Dispatch types (verification, parent, cycle, recovery) |
| [JOB_LIFECYCLE.md](./JOB_LIFECYCLE.md) | Job status values, transitions, inference logic |
| [ERROR_CODES.md](./ERROR_CODES.md) | Error codes and troubleshooting |
| [ARTIFACTS.md](./ARTIFACTS.md) | Artifact types, creation, measurement coverage |

---

## Deep Dive Documentation

For comprehensive technical details, see:
- `docs/documentation/` - Technical architecture docs
- `docs/spec/` - Specifications and standards
- `docs/guides/` - How-to guides

---

## Contributing

When adding new reference docs:
1. Keep them concise (~100-200 lines)
2. Include tables for quick lookup
3. Link to deep-dive docs for more detail
4. Update this README
