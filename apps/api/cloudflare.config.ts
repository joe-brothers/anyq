import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "anyq-api",
		compatibilityDate: "2026-11-17",
		entrypoint,
		observability: { enabled: true },
		env: {
			// Turnstile은 선택 사항이다. TURNSTILE_SECRET이 없으면 검증 없이 방을 만든다.
			TURNSTILE_SITEKEY: bindings.text("0x4AAAAAAGLfNyYLK2cRHUrG"),
			TURNSTILE_SECRET: bindings.secret(),
			// 비슷한 질문 묶기용 임베딩
			AI: bindings.ai({ dev: { remote: true } }),
			AI_SEARCH: bindings.aiSearchNamespace({ namespace: "default", dev: { remote: true } }),
		},
		exports: {
			Room: exports.durableObject({ storage: "sqlite" }),
		},
	},
});
