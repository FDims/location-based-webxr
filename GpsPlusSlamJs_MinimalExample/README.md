# gps-plus-slam minimal example

The smallest end-to-end consumer of
[`gps-plus-slam-app-framework`](../GpsPlusSlamJs_AppFramework/) — a
single-file Vite app that boots `createRecorderStore()`, renders a
spinning cube with Three.js, and shows a tiny status panel driven by
the store.

## Why this exists

1. **Onboarding scaffold.** The full
   [recorder app](../GpsPlusSlamJs_RecorderApp/) is too big to read as
   a "hello world". This example is intentionally trivial so the wiring
   is obvious. For the next step up — a readable AR + GPS + persistence
   demo — see the
   [`GpsPlusSlamJs_AnchorStarter`](../GpsPlusSlamJs_AnchorStarter/)
   starter (trivial → **starter** → full).
2. **Anonymous-install proof.** The package declares only
   `gps-plus-slam-app-framework: workspace:*` for the sibling package - A clean `pnpm install` at the public-repo root that
   successfully resolves the framework.

## Run it

```bash
# from the public repo root
pnpm install
pnpm --filter gps-plus-slam-minimal-example dev
```

Then open the printed URL.

## Layout

- [index.html](index.html) — bare entry, one canvas + one status panel.
- [src/main.ts](src/main.ts) — Three.js scene, store wiring, status updates.
- [src/status.ts](src/status.ts) — pure formatter for the status text
  (sole unit-tested module — see [src/status.test.ts](src/status.test.ts)).
