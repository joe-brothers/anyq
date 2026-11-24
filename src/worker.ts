import api from "@anyq/api";
import { handle } from "@astrojs/cloudflare/handler";

export { Room } from "@anyq/api";

// /api/* 는 Hono 앱이, 나머지는 Astro가 맡는다. Worker 하나라 CORS와 API 주소 설정이 없다.
export default {
	fetch(request, env, ctx) {
		const { pathname } = new URL(request.url);
		if (pathname === "/api" || pathname.startsWith("/api/")) return api.fetch(request, env, ctx);
		return handle(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
