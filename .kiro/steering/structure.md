---
inclusion: always
---
# Repo structure
```
/.kiro/            specs, steering, hooks (committed, never gitignored)
/packages/core     venue adapters, matcher, fusion, divergence (pure TS, fully tested)
/packages/mcp      MCP server exposing core as tools
/apps/web          Ouija dashboard (Vite/React)
/apps/api          Worker/edge API wrapping core
/docs              architecture.md, kiro-usage.md, demo-script.md
LICENSE (MIT), README.md
```
Adapters return a normalized `Market { venue, id, title, eventKey?, outcome, prob, liquidity?, closesAt, url, fetchedAt }`.
