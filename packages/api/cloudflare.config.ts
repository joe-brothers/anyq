import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// 테스트 전용. 배포 설정은 저장소 루트의 wrangler.jsonc에 있고, 바인딩 이름을 그것과 맞춘다.
export default defineConfig({
	worker: {
		name: "anyq-api-test",
		compatibilityDate: "2026-11-17",
		entrypoint,
		env: {
			AI: bindings.ai({ dev: { remote: true } }),
			AI_SEARCH: bindings.aiSearchNamespace({ namespace: "default", dev: { remote: true } }),
		},
		exports: {
			Room: exports.durableObject({ storage: "sqlite" }),
		},
	},
});
