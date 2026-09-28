import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true },
  build: { chunkSizeWarningLimit: 1200 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
