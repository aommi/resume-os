# Cold start — moved

This bootstrap has been retired in favor of a runtime adapter that calls the neutral resolver.

- **Claude Code:** start from `adapters/claude-code-bootstrap.md`.
- **Routing core (any runtime):** `engine/resolver.md` + `engine/resolver.json` (which docs load per task).

The old "read these four docs every session" behavior is preserved as the resolver's default/fallback
route, so nothing is lost — but prefer task-based routing.
