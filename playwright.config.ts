import { defineConfig, devices } from '@playwright/test'

// Keep test fixtures independent of an IDE dev server and its HMR module instances.
const port = Number(process.env.MELOARK_TEST_PORT ?? 5174)
const url = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 3,
  reporter: process.env.GITHUB_ACTIONS ? [['list'], ['github']] : 'list',
  use: { baseURL: url, trace: 'retain-on-failure' },
  webServer: { command: `npm run ${process.env.MELOARK_TEST_BUILD === '1' ? 'preview' : 'dev'} -- --port ${port} --strictPort`, url, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath: process.env.MELOARK_CHROMIUM_EXECUTABLE } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
