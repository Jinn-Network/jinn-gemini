// Centralized context management helpers: cursor encoding, token estimation, single-page builder
export function estimateTokensFromJSON(payload) {
    // Simple heuristic: ~4 chars per token
    const json = JSON.stringify(payload);
    const chars = json ? json.length : 0;
    const tokens = Math.ceil(chars / 4);
    return { tokens, estimated: true };
}
export function encodeCursor(keyset) {
    const json = JSON.stringify({ v: 1, k: keyset });
    return Buffer.from(json, 'utf8').toString('base64');
}
export function decodeCursor(cursor) {
    if (!cursor)
        return undefined;
    try {
        const json = Buffer.from(cursor, 'base64').toString('utf8');
        const parsed = JSON.parse(json);
        return parsed.k;
    }
    catch {
        return undefined;
    }
}
export function deepTruncateStrings(value, maxChars) {
    if (value == null)
        return value;
    if (typeof value === 'string') {
        if (maxChars <= 0)
            return value;
        return value.length > maxChars ? value.slice(0, maxChars) + '... [truncated]' : value;
    }
    if (Array.isArray(value))
        return value.map(v => deepTruncateStrings(v, maxChars));
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = deepTruncateStrings(v, maxChars);
        }
        return out;
    }
    return value;
}
export function deepTruncateByField(value, policy) {
    if (value == null)
        return value;
    if (Array.isArray(value))
        return value.map(v => deepTruncateByField(v, policy));
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            const limit = policy[k];
            if (typeof v === 'string' && typeof limit === 'number' && limit >= 0) {
                out[k] = v.length > limit ? v.slice(0, limit) + '... [truncated]' : v;
            }
            else {
                out[k] = deepTruncateByField(v, policy);
            }
        }
        return out;
    }
    return value;
}
export function buildSinglePageFromItems(allItems, opts = {}) {
    const pageTokenBudget = opts.pageTokenBudget ?? 15000;
    const truncateChars = opts.truncateChars ?? 200;
    const startOffset = opts.startOffset ?? 0;
    const policy = opts.truncationPolicy;
    const enforceHardBudget = opts.enforceHardPageBudget ?? true;
    const enforceFieldClamp = opts.enforceHardFieldClamp ?? true;
    const perFieldMaxChars = enforceFieldClamp ? (opts.perFieldMaxChars ?? 4000) : undefined;
    const applyPolicyThenClamp = (item) => {
        // Apply field-aware policy first, else generic per-item truncation
        const policyApplied = policy
            ? deepTruncateByField(item, policy)
            : (truncateChars >= 0 ? deepTruncateStrings(item, truncateChars) : item);
        // Then apply the global field clamp (if enabled)
        return typeof perFieldMaxChars === 'number'
            ? deepTruncateStrings(policyApplied, perFieldMaxChars)
            : policyApplied;
    };
    const page = [];
    let runningTokens = 0;
    for (let i = startOffset; i < allItems.length; i++) {
        const candidate = applyPolicyThenClamp(allItems[i]);
        const nextPage = [...page, candidate];
        const est = estimateTokensFromJSON(nextPage);
        if (enforceHardBudget && est.tokens > pageTokenBudget) {
            // If we already have items, stop before overflowing
            if (page.length > 0) {
                break;
            }
            // Single-item overflow at current offset, even after clamp → skip-and-advance
            const nextCursor = encodeCursor({ offset: i + 1 });
            return {
                pageItems: [],
                nextCursor,
                tokens: { tokens: 0, estimated: true },
            };
        }
        // Safe to include
        page.push(candidate);
        runningTokens = est.tokens;
    }
    const nextOffset = startOffset + page.length;
    const hasMore = nextOffset < allItems.length;
    const nextCursor = hasMore ? encodeCursor({ offset: nextOffset }) : undefined;
    return {
        pageItems: page,
        nextCursor,
        tokens: { tokens: runningTokens, estimated: true }
    };
}
export function composeSinglePageResponse(allItems, opts = {}) {
    const budget = opts.pageTokenBudget ?? 15000;
    const warnAt = opts.warnThresholdTokens ?? 100000;
    const page = buildSinglePageFromItems(allItems, opts);
    // Compute full tokens using the same truncation policy as the page
    const truncateOne = (item) => {
        const hasPolicy = Boolean(opts.truncationPolicy);
        const perItemMax = opts.truncateChars ?? 200;
        const clampEnabled = opts.enforceHardFieldClamp ?? true;
        const clampMax = clampEnabled ? (opts.perFieldMaxChars ?? 4000) : undefined;
        let v = hasPolicy
            ? deepTruncateByField(item, opts.truncationPolicy)
            : (perItemMax >= 0 ? deepTruncateStrings(item, perItemMax) : item);
        if (typeof clampMax === 'number') {
            v = deepTruncateStrings(v, clampMax);
        }
        return v;
    };
    const truncatedAll = allItems.map(truncateOne);
    const fullEst = estimateTokensFromJSON(truncatedAll);
    const warnings = [];
    if (fullEst.tokens > warnAt) {
        warnings.push(`Full results estimated at ~${fullEst.tokens.toLocaleString()} tokens; including them may inflate context.`);
    }
    const meta = {
        requested: opts.requestedMeta,
        tokens: {
            page_tokens: page.tokens.tokens,
            full_tokens: fullEst.tokens,
            budget_tokens: budget,
            estimated: true,
        },
        has_more: Boolean(page.nextCursor),
        next_cursor: page.nextCursor,
        warnings: warnings.length ? warnings : undefined,
    };
    return { meta, data: page.pageItems };
}
