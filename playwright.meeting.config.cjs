const {defineConfig} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const pythonVenv = path.join(__dirname, 'repos', 'trato-api', '.venv', 'Scripts', 'python.exe');
const pythonCommand = fs.existsSync(pythonVenv) ? `"${pythonVenv}"` : 'py -3.12';

module.exports = defineConfig({
  testDir: './tests/browser',
  testMatch: '**/meeting-copilot.spec.cjs',
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  outputDir: '.local/browser-tests/copilot-artifacts',
  use: {
    baseURL: 'http://localhost:5173',
    browserName: 'chromium',
    viewport: {width: 1440, height: 1000},
    screenshot: 'only-on-failure'
  },
  webServer: [
    {
      command: 'node server.mjs',
      url: 'http://127.0.0.1:5173/health',
      reuseExistingServer: true,
      timeout: 30_000,
      env: {
        PORT: '5173',
        HOST: '127.0.0.1',
        TRATO_API_URL: 'http://127.0.0.1:8100',
        TRATO_MEETING_BACKEND_URL: 'http://127.0.0.1:8100',
        TRATO_MEETING_ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173'
      }
    },
    {
      command: `${pythonCommand} "${path.join(__dirname, 'tests', 'meeting_copilot_e2e_server.py')}"`,
      url: 'http://127.0.0.1:8100/health',
      reuseExistingServer: true,
      timeout: 30_000
    }
  ]
});