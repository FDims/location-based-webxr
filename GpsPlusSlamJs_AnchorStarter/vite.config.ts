import { defineConfig } from 'vite';

// Starter-example Vite config. AppFramework resolves through the pnpm
// workspace symlink; the published gps-plus-slam-js comes from node_modules.
// No aliases needed. A distinct port keeps it runnable alongside the minimal
// example (5180) and recorder.
export default defineConfig({
  server: {
    port: 5181,
  },
});
