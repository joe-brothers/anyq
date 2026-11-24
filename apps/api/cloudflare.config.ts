import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode }) => {
	// 로컬(cf dev)은 항상 통과하는 공개 테스트 키를 쓴다. 운영 위젯에는 localhost를 넣지 않는다.
	const dev = mode === "development";
	return {
		worker: {
			name: "anyq-api",
			compatibilityDate: "2026-11-17",
			entrypoint,
			observability: { enabled: true },
			env: {
				// Turnstile은 선택 사항이다. TURNSTILE_SECRET이 없으면 검증 없이 방을 만든다.
				TURNSTILE_SITEKEY: bindings.text(dev ? "1x00000000000000000000AA" : "0x4AAAAAAGLfNyYLK2cRHUrG"),
				TURNSTILE_SECRET: dev ? bindings.text("1x0000000000000000000000000000000AA") : bindings.secret(),
				// 비슷한 질문 묶기용 임베딩
				AI: bindings.ai({ dev: { remote: true } }),
				AI_SEARCH: bindings.aiSearchNamespace({ namespace: "default", dev: { remote: true } }),
			},
			exports: {
				Room: exports.durableObject({ storage: "sqlite" }),
			},
		},
	};
});
