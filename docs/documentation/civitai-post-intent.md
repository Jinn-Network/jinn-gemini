## Civitai Post Intent and Session Setup

This repo supports two flows:

- Scripted browser automation (Playwright) for end-to-end posting, using a persistent Chrome profile.
- An MCP tool that builds a Post Intent URL and attempts an automated publish using a persistent Chrome profile.

### Persistent Chrome profile (one-time per machine)

- Profile path: `./.playwright-mcp/google-profile`
- The script launches Chrome via Playwright with `launchPersistentContext(profileDir, { channel: 'chrome' })`.
- Cookies/local storage are saved to that directory and reused across runs.

Steps on a new machine:

1) Install dependencies
```
yarn install
yarn playwright install
```

2) Sign into Google (persistent profile)
```
yarn civitai:post-intent-debug --google-login-manual true --headless false
```
Complete Google login in the window that opens, then close it.

3) Sign into Civitai in the same profile (via Google)
```
yarn civitai:post-intent-debug --verify-civitai-session true --headless false
```
If not logged in, click Sign in → Google and allow the redirect. Close the window when the avatar/menu is visible.

4) Publish using the script (automated)
```
yarn civitai:post-intent-debug --media <durable_image_url> --title "..." --description "..." --tags tag1,tag2 --publish --headless false
```

Reset: delete `./.playwright-mcp/google-profile`.

### MCP tool: civitai_publish_post

The MCP tool constructs a Civitai Post Intent URL and then tries to auto-publish using Playwright with your persistent Chrome profile. If publishing succeeds, it returns the created post URL; if not, it returns the intent URL and a non-OK status so you can finish manually.

Inputs:
- media_url (required) — public, CORS-enabled, durable image URL (e.g., Supabase public object URL)
- title (required)
- description (required)
- tags (required; array of strings, max 5). Extra tags are trimmed/deduped and capped at 5.

Outputs:
- `post_intent_url` — `https://civitai.com/intent/post?...`
- `post_url` — present when auto-publish completes (e.g., `https://civitai.com/posts/12345678`)
- When auto-publish cannot complete, the tool returns `{ ok: false, code: 'AUTO_PUBLISH_INCOMPLETE' }` with the `post_intent_url` for manual confirmation.

Environment (optional):
- `PLAYWRIGHT_PROFILE_DIR` — path to persistent Chrome profile. Defaults to auto-detect `./.playwright-mcp/google-profile`, then `~/.jinn/playwright-profile`.
- `PLAYWRIGHT_HEADLESS` — set to `false` to run headful (default is headless).

Notes:
- The tool reuses your Google/Civitai session from the persistent profile. If not logged in, it will try Google sign-in; you may need to log in once using the debug script.


