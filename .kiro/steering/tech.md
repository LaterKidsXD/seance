---
inclusion: always
---
# Tech constraints
- TypeScript everywhere, strict mode. Node 20+. pnpm.
- Frontend: Vite, React 18, Tailwind, Framer Motion. Back end: Cloudflare Workers (or Vercel functions) and KV cache.
- MCP server: @modelcontextprotocol/sdk, sharing the core package with the API.
- **$0 runtime cost:** no paid APIs, no LLM calls at runtime. Public read-only market endpoints only. Cache aggressively (≥30 s) and respect rate limits.
- Tests: Vitest. **Use fast-check property-based tests for all math** (probability normalization, fusion bounds, matcher symmetry).
- Never log or store secrets. No user accounts in the MVP.
- Every new module needs a unit or property test before merge (enforced by a hook).
