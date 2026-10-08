import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Optimize worker/lazy readers before selection so dependency discovery
  // cannot reload the dev page and disconnect its selected files.
  optimizeDeps: { include: ['music-metadata', 'mediabunny', '@dnd-kit/react', '@dnd-kit/dom', '@tanstack/react-virtual'] },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.ts'],
    restoreMocks: true,
  },
})
