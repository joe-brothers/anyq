import { defineConfig } from "@playwright/test";

// 실제 브라우저로 흐름을 확인한다. 먼저 `pnpm dev`를 띄워 둔다.
// API는 Workers AI에 원격으로 붙으므로 `cf auth login`이 되어 있어야 한다.
export default defineConfig({
	testDir: "tests",
	timeout: 60_000,
	expect: { timeout: 20_000 },
	workers: 1,
	use: {
		baseURL: "http://localhost:4321",
		locale: "ko-KR",
		// 설치된 Chrome을 쓴다. 따로 받으려면 `playwright install chromium` 뒤 이 줄을 지운다.
		channel: process.env.CI ? undefined : "chrome",
	},
});
