import { env } from "cloudflare:workers";
import { FILE_TYPES, MAX_FILE_BYTES, ROOM_ID, instanceId } from "./protocol.ts";

export { Room } from "./room.ts";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function randomId(): string {
	return Array.from(
		crypto.getRandomValues(new Uint8Array(6)),
		(b) => ALPHABET[b % ALPHABET.length],
	).join("");
}

function randomToken(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

export async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 발표 자료: 방마다 AI Search 인스턴스 하나의 내장 스토리지에 올린다. */
async function files(
	request: Request,
	roomId: string,
	count: number,
	added: () => Promise<number>,
): Promise<Response> {
	const name = instanceId(roomId);
	if (request.method === "GET") {
		if (!count) return Response.json([]);
		const { result } = await env.AI_SEARCH.get(name).items.list({ per_page: 50 });
		return Response.json(result.map((item) => ({ key: item.key, status: item.status })));
	}
	if (request.method !== "POST") return Response.json({ error: "method" }, { status: 405 });

	let fileName: string;
	try {
		fileName = decodeURIComponent(request.headers.get("x-file-name") ?? "");
	} catch {
		fileName = "";
	}
	fileName = (fileName.split(/[\\/]/).pop() ?? "").trim().slice(-128);
	if (!FILE_TYPES.test(fileName)) return Response.json({ error: "type" }, { status: 415 });
	const size = Number(request.headers.get("content-length"));
	if (!request.body || !(size > 0)) return Response.json({ error: "empty" }, { status: 400 });
	if (size > MAX_FILE_BYTES) return Response.json({ error: "size" }, { status: 413 });

	if (!count) {
		try {
			// 한국어 키워드 검색은 trigram, 이미지가 많은 슬라이드 PDF는 OCR이 필요하다.
			const indexing_options = { keyword_tokenizer: "trigram", use_ocr: true } as const;
			await env.AI_SEARCH.create({ id: name, indexing_options });
		} catch (e) {
			// 같은 방에 첫 자료 두 개가 동시에 올라오면 이미 만들어져 있다.
			console.warn(JSON.stringify({ msg: "instance_create", room: roomId, error: String(e) }));
		}
	}
	const item = await env.AI_SEARCH.get(name).items.upload(fileName, await request.blob());
	await added();
	return Response.json({ key: item.key }, { status: 201 });
}

/** Turnstile 토큰을 확인한다. 비밀 키가 없는 배포에서는 검증하지 않는다. */
async function human(request: Request): Promise<boolean> {
	if (!env.TURNSTILE_SECRET) return true;
	const { token } = await request.json<{ token?: string }>().catch(() => ({ token: undefined }));
	if (!token || token.length > 2048) return false;
	const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
		method: "POST",
		body: JSON.stringify({
			secret: env.TURNSTILE_SECRET,
			response: token,
			remoteip: request.headers.get("CF-Connecting-IP") ?? undefined,
		}),
		headers: { "content-type": "application/json" },
	});
	return res.ok && (await res.json<{ success: boolean }>()).success === true;
}

/** 발표자 키는 주소가 아니라 헤더로 받는다. 주소는 로그에 남는다. */
const bearer = (request: Request) =>
	request.headers.get("authorization")?.replace(/^Bearer /, "") || null;

const notFound = () => Response.json({ error: "not_found" }, { status: 404 });

export default {
	async fetch(request, _env, ctx) {
		const url = new URL(request.url);
		const parts = url.pathname.split("/").filter(Boolean);

		if (url.pathname === "/api/config") {
			return Response.json({ sitekey: env.TURNSTILE_SECRET ? env.TURNSTILE_SITEKEY : "" });
		}

		if (parts[0] === "api" && parts[1] === "rooms") {
			if (parts.length === 2 && request.method === "POST") {
				if (!(await human(request))) return Response.json({ error: "turnstile" }, { status: 403 });
				const token = randomToken();
				const hash = await sha256(token);
				for (let i = 0; i < 3; i++) {
					const id = randomId();
					if (await ctx.exports.Room.getByName(id).init(hash, id))
						return Response.json({ id, token }, { status: 201 });
				}
				return Response.json({ error: "try_again" }, { status: 503 });
			}
			const id = parts[2] ?? "";
			if (!ROOM_ID.test(id)) return notFound();
			const room = ctx.exports.Room.getByName(id);
			if (parts.length === 3 && request.method === "GET") {
				const key = bearer(request);
				const info = await room.check(key ? await sha256(key) : null);
				return info ? Response.json(info) : notFound();
			}
			if (parts.length === 4 && parts[3] === "files") {
				const key = bearer(request);
				const info = await room.check(key ? await sha256(key) : null);
				if (!info) return notFound();
				if (!info.host) return Response.json({ error: "host_only" }, { status: 403 });
				return files(request, id, info.files, () => room.addFile());
			}
			if (parts.length === 4 && parts[3] === "ws") {
				if (request.headers.get("Upgrade") !== "websocket") {
					return Response.json({ error: "websocket_only" }, { status: 426 });
				}
				return room.fetch(request);
			}
			return notFound();
		}

		if (
			parts[0] === "r" &&
			ROOM_ID.test(parts[1] ?? "") &&
			(parts.length === 2 || (parts.length === 3 && (parts[2] === "host" || parts[2] === "screen")))
		) {
			return env.ASSETS.fetch(new Request(new URL("/room", url), request));
		}
		return notFound();
	},
} satisfies ExportedHandler;
