import { env } from "cloudflare:workers";

/** API Worker로 요청을 넘긴다. 로컬 개발에서는 따로 띄운 개발 서버로 간다. */
export function toApi(request: Request): Promise<Response> {
	if (!env.API_ORIGIN) return env.API.fetch(request);
	const url = new URL(request.url);
	return fetch(new Request(env.API_ORIGIN + url.pathname + url.search, request));
}
