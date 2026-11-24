import { defineConfig } from "vite-plus";

// 저장소 전체의 포맷과 린트 설정. 빌드는 앱마다 따로 한다.
export default defineConfig({
	fmt: { useTabs: true, ignorePatterns: ["**/legacy/**", "**/*.astro"] },
	// 웹의 Worker 쪽 파일은 전역 타입이 달라 tsconfig.server.json으로 따로 검사한다.
	lint: {
		options: { typeAware: true, typeCheck: true },
		ignorePatterns: ["apps/web/src/worker.ts", "apps/web/src/server/**"],
	},
});
