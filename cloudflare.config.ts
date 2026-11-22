import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "anyq",
		compatibilityDate: "2026-11-17",
		entrypoint,
		assets: { runWorkerFirst: ["/api/*", "/r/*"] },
		observability: { enabled: true },
		env: {
			ASSETS: bindings.assets(),
			// Turnstile은 선택 사항이다. TURNSTILE_SECRET이 없으면 검증 없이 방을 만든다.
			TURNSTILE_SITEKEY: bindings.text("0x4AAAAAAGLfNyYLK2cRHUrG"),
			TURNSTILE_SECRET: bindings.secret(),
			AI_SEARCH: bindings.aiSearchNamespace({ namespace: "default", dev: { remote: true } }),
		},
		exports: {
			Room: exports.durableObject({ storage: "sqlite" }),
		},
	},
});
