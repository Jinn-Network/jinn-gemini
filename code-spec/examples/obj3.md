# obj3: Minimize Harm

This example demonstrates the "Minimize harm" objective through security, safety, and privacy best practices.

## ✅ Correct: Secure by Default

### Input Validation

```typescript
import { z } from 'zod';

const UserInputSchema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0).max(150),
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
});

export async function createUser(rawInput: unknown) {
  // Validate and sanitize all external input
  const parsed = UserInputSchema.safeParse(rawInput);

  if (!parsed.success) {
    throw new Error(`Invalid user input: ${parsed.error.message}`);
  }

  const { email, age, username } = parsed.data;

  // Use parameterized queries to prevent SQL injection
  await db.query(
    'INSERT INTO users (email, age, username) VALUES ($1, $2, $3)',
    [email, age, username]
  );
}
```

### Secret Management

```typescript
// ✅ Secrets from environment variables, never hardcoded
const apiKey = process.env.API_KEY;
if (!apiKey) {
  throw new Error('API_KEY environment variable is required');
}

// ✅ API key never logged or exposed
logger.info('API request initiated', { endpoint: '/users' });
// NOT: logger.info('API request', { apiKey }); ❌
```

### Fail Securely

```typescript
export async function checkAccess(userId: string, resourceId: string): Promise<boolean> {
  try {
    const permission = await db.query(
      'SELECT * FROM permissions WHERE user_id = $1 AND resource_id = $2',
      [userId, resourceId]
    );

    // Explicit check - only return true if permission exists
    return permission.rows.length > 0;
  } catch (error) {
    // Fail closed: On error, deny access (secure default)
    logger.error('Permission check failed', { userId, resourceId, error });
    return false; // ✅ Deny by default
  }
}
```

---

## ❌ Violation: Insecure Patterns

### No Input Validation

```typescript
export async function createUser(input: any) {
  // ❌ Direct use of untrusted input - SQL injection risk
  await db.query(
    `INSERT INTO users (email, age, username) VALUES ('${input.email}', ${input.age}, '${input.username}')`
  );
  // Malicious input: { email: "'; DROP TABLE users; --", ... }
}
```

### Hardcoded Secrets

```typescript
// ❌ API key committed to repository
const API_KEY = 'sk-abc123xyz789';

// ❌ Secrets in comments (still searchable in git history)
// Production API key: sk-prod-real-key-here
```

### Fail Open

```typescript
export async function checkAccess(userId: string, resourceId: string): Promise<boolean> {
  try {
    const permission = await db.query(/* ... */);
    return permission.rows.length > 0;
  } catch (error) {
    // ❌ On error, grant access (insecure default)
    logger.warn('Permission check failed, granting access anyway', error);
    return true; // ❌ Grant by default
  }
}
```

### Excessive Logging

```typescript
// ❌ Logs sensitive data
logger.info('User login', {
  username: user.username,
  password: user.password, // ❌ Never log passwords
  ssn: user.ssn,           // ❌ Never log PII
  creditCard: user.cc,     // ❌ Never log payment info
});
```

---

## Key Security Principles

### 1. **Validate All External Input**
- API request bodies
- Query parameters
- File uploads
- Environment variables (when from untrusted sources)
- Database query results (when from user-controlled data)

### 2. **Never Commit Secrets**
- API keys, tokens, passwords
- Private keys, certificates
- Database credentials
- Any sensitive configuration

### 3. **Fail Closed, Not Open**
- On auth failure → deny access
- On validation error → reject input
- On permission check error → deny permission

### 4. **Principle of Least Privilege**
- Database connections use read-only users when possible
- API tokens scoped to minimum necessary permissions
- File system access restricted to required directories

### 5. **Defense in Depth**
- Multiple layers of validation
- Parameterized queries even with validated input
- Rate limiting + input validation + authentication

---

## Application to AI Code Generation

When AI generates code:
1. **Default to secure patterns:** Use parameterized queries, not string concatenation
2. **Require explicit validation:** Never trust external input
3. **Reject insecure examples:** Don't learn from code with hardcoded secrets
4. **Question convenience:** If it's easier but less secure, choose secure

The "Minimize harm" objective prevents AI from propagating security anti-patterns across sessions.
