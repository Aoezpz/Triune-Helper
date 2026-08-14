import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * The test runner needs the same `@shared` alias the three electron-vite builds
 * define, because the suites now reach into `src/main` as well as `src/shared`.
 *
 * Only main modules with no Electron import can be tested this way - the HTML
 * card readers, the pure helpers. That is not a limitation so much as a hint
 * about where logic belongs: anything worth testing should not need a window.
 */
export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  test: {
    include: ['tests/**/*.test.ts']
  }
})
