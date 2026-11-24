import { handle } from "@astrojs/cloudflare/handler";
import { toApi } from "./server/api.ts";

// /api/* 는 API Worker로 넘기고, 나머지는 Astro가 그린다.
// 브라우저는 늘 같은 출처만 부르므로 CORS와 API 주소 설정이 없다.
export default {
	fetch(request, env, ctx) {
		const { pathname } = new URL(request.url);
		if (pathname === "/api" || pathname.startsWith("/api/")) return toApi(request);
		return handle(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
