import api from "@anyq/api";
import { env } from "cloudflare:workers";

/** 서버에서 그릴 때 같은 Worker 안의 API를 네트워크 없이 부른다. */
export const toApi = (request: Request, ctx: ExecutionContext) => api.fetch(request, env, ctx);
