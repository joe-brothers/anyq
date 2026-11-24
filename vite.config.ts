import { defineConfig } from "vite-plus";

// 저장소 전체의 포맷과 린트 설정. 빌드는 Astro가 한다(astro.config.mjs).
export default defineConfig({
	fmt: { useTabs: true, ignorePatterns: ["**/legacy/**", "**/*.astro"] },
	// Worker 쪽 파일은 전역 타입이 달라 tsconfig.server.json으로 따로 검사한다.
	lint: {
		options: { typeAware: true, typeCheck: true },
		ignorePatterns: ["src/worker.ts", "src/server/**"],
	},
});
