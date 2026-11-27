import { vValidator } from "@hono/valibot-validator";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
	CreateRoomSchema,
	FILE_TYPES,
	JoinSchema,
	LIMITS,
	ROOM_ID,
	instanceId,
	type Config,
	type CreatedRoom,
	type FileItem,
	type RoomInfo,
} from "@anyq/protocol";
import { randomId, randomToken, sha256 } from "./crypto.ts";

export { Room } from "./room.ts";

/** 계정이 생기면 여기서 요청한 사람을 알아낸다. 지금은 모두 익명이다. */
type Actor = { id: string | null };
type Vars = { actor: Actor; room: DurableObjectStub<import("./room.ts").Room>; roomId: string };
type App = { Variables: Vars };

const actor = createMiddleware<App>(async (c, next) => {
	c.set("actor", { id: null });
	await next();
});

/** 방 주소를 확인하고 Durable Object를 찾는다. */
const room = createMiddleware<App>(async (c, next) => {
	const id = c.req.param("id") ?? "";
	if (!ROOM_ID.test(id)) return c.json({ error: "not_found" }, 404);
	c.set("roomId", id);
	c.set("room", (c.executionCtx as ExecutionContext).exports.Room.getByName(id));
	await next();
});

/** 발표자 키는 주소가 아니라 헤더로 받는다. 주소는 로그에 남는다. */
async function keyHash(header: string | undefined): Promise<string | null> {
	const key = header?.replace(/^Bearer /, "");
	return key ? sha256(key) : null;
}

/** Turnstile은 선택 사항이라 설정 파일이 아니라 비밀 값으로 받는다. */
const turnstile = env as { TURNSTILE_SITEKEY?: string; TURNSTILE_SECRET?: string };

/** Turnstile 토큰을 확인한다. 비밀 키가 없는 배포에서는 검증하지 않는다. 테스트 키는 action을 돌려주지 않는다. */
async function human(
	token: string | undefined,
	ip: string | undefined,
	action: "create" | "join",
): Promise<boolean> {
	if (!turnstile.TURNSTILE_SECRET) return true;
	if (!token) return false;
	const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
		method: "POST",
		body: JSON.stringify({ secret: turnstile.TURNSTILE_SECRET, response: token, remoteip: ip }),
		headers: { "content-type": "application/json" },
	});
	if (!res.ok) return false;
	const r = await res.json<{ success: boolean; action?: string }>();
	return r.success === true && (!r.action || r.action === action);
}

const v1 = new Hono<App>()
	.use(actor)
	.get("/config", (c) =>
		c.json<Config>({ sitekey: (turnstile.TURNSTILE_SECRET && turnstile.TURNSTILE_SITEKEY) || "" }),
	)
	.post(
		"/rooms",
		vValidator("json", CreateRoomSchema, (result, c) => {
			if (!result.success) return c.json({ error: "turnstile" }, 403);
		}),
		async (c) => {
			if (!(await human(c.req.valid("json").token, c.req.header("CF-Connecting-IP"), "create")))
				return c.json({ error: "turnstile" }, 403);
			const token = randomToken();
			const hash = await sha256(token);
			const rooms = (c.executionCtx as ExecutionContext).exports.Room;
			for (let i = 0; i < 3; i++) {
				const id = randomId();
				if (await rooms.getByName(id).init(hash, id, c.var.actor.id))
					return c.json<CreatedRoom>({ id, token }, 201);
			}
			return c.json({ error: "try_again" }, 503);
		},
	)
	.get("/rooms/:id", room, async (c) => {
		const info = await c.var.room.check(await keyHash(c.req.header("authorization")));
		return info ? c.json<RoomInfo>(info, 200) : c.json({ error: "not_found" }, 404);
	})
	// 처음 질문·추천하는 추천인을 사람으로 확인한다.
	.post(
		"/rooms/:id/join",
		room,
		vValidator("json", JoinSchema, (result, c) => {
			if (!result.success) return c.json({ error: "turnstile" }, 403);
		}),
		async (c) => {
			const { token, voter } = c.req.valid("json");
			if (!(await human(token, c.req.header("CF-Connecting-IP"), "join")))
				return c.json({ error: "turnstile" }, 403);
			return (await c.var.room.pass(voter))
				? c.body(null, 204)
				: c.json({ error: "not_found" }, 404);
		},
	)
	.get("/rooms/:id/ws", room, async (c) => {
		if (c.req.header("Upgrade") !== "websocket") return c.json({ error: "websocket_only" }, 426);
		return c.var.room.fetch(c.req.raw);
	})
	// 발표 자료: 방마다 AI Search 인스턴스 하나의 내장 스토리지에 올린다.
	.on(["GET", "POST"], "/rooms/:id/files", room, async (c) => {
		const info = await c.var.room.check(await keyHash(c.req.header("authorization")));
		if (!info) return c.json({ error: "not_found" }, 404);
		if (!info.host) return c.json({ error: "host_only" }, 403);
		const name = instanceId(c.var.roomId);

		if (c.req.method === "GET") {
			if (!info.files) return c.json([] as FileItem[], 200);
			const { result } = await env.AI_SEARCH.get(name).items.list({ per_page: 50 });
			return c.json(
				result.map((item): FileItem => ({ key: item.key, status: item.status })),
				200,
			);
		}

		let fileName: string;
		try {
			fileName = decodeURIComponent(c.req.header("x-file-name") ?? "");
		} catch {
			fileName = "";
		}
		fileName = (fileName.split(/[\\/]/).pop() ?? "").trim().slice(-128);
		if (!FILE_TYPES.test(fileName)) return c.json({ error: "type" }, 415);
		const size = Number(c.req.header("content-length"));
		if (!c.req.raw.body || !(size > 0)) return c.json({ error: "empty" }, 400);
		if (size > LIMITS.fileBytes) return c.json({ error: "size" }, 413);

		if (!info.files) {
			try {
				// 한국어 키워드 검색은 trigram, 이미지가 많은 슬라이드 PDF는 OCR이 필요하다.
				const indexing_options = { keyword_tokenizer: "trigram", use_ocr: true } as const;
				await env.AI_SEARCH.create({ id: name, indexing_options });
			} catch (e) {
				// 같은 방에 첫 자료 두 개가 동시에 올라오면 이미 만들어져 있다.
				console.warn(
					JSON.stringify({ msg: "instance_create", room: c.var.roomId, error: String(e) }),
				);
			}
		}
		const item = await env.AI_SEARCH.get(name).items.upload(fileName, await c.req.blob());
		await c.var.room.addFile();
		return c.json({ key: item.key }, 201);
	});

const app = new Hono()
	.route("/api/v1", v1)
	.notFound((c) => c.json({ error: "not_found" }, 404))
	.onError((e, c) => {
		console.error(JSON.stringify({ msg: "unhandled", path: c.req.path, error: String(e) }));
		return c.json({ error: "internal" }, 500);
	});

export default app;
