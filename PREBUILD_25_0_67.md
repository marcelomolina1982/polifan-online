# Polifan V2 25.0.67 prebuild

Isolated release candidate validation marker.

- Vercel production is not deployed from this branch.
- GitHub Actions validates the locked frontend build.
- Render Motor and Vía Cargo health are smoke-tested before promotion.
- Motor production frontend must contain only the fresh V5 status proxy.
- Public catalog links must resolve to the canonical catalog deployment.
- Motor durable-store credential rotation is complete and must pass the post-rotation health smoke test.
