# The OpenAPI YAML is a generable HTTP contract, broken in lockstep with the SPA

`backend/docs/API_DOCUMENTATION.yaml` is the source of truth for HTTP operations: named path params (no polymorphic `{id}`), Zod bodies aligned with `$ref`s, query flags as the strings `'true'`/`'false'`, and per-operation error `$ref`s. RPC paths (`/assign`, `/end`, …) stay. There is no `/v2`; backend, YAML, and SPA change together. Error JSON is `{ error, message, code }` with optional `setupUrl` / `usage` / `omitted`; invitation lists are `{ invitations: […] }` and screens that read the old shapes are updated. An unreadable asset is 404 from `canReadAsset` for both metadata and bytes. Invalid limiter config refuses process start. An MCP server is out of scope.

**Status**: accepted
