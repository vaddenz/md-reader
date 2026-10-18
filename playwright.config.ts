import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  // 移动端布局下的异步渲染（mermaid 动态加载、IDB 读取）留出更宽裕的断言时间
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://localhost:4173/md-reader/', ...devices['Pixel 7'] },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/md-reader/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
