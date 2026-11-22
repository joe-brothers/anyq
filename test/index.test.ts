import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import type { ServerMsg } from "../src/protocol.ts";

const origin = "https://example.com";

// 임베딩은 네트워크 없이 흉내 낸다.
beforeEach(() => {
	// PDF가 들어간 질문끼리만 같은 벡터를 준다.
	vi.spyOn(env.AI, "run").mockImplementation((async (
		_model: string,
		input: { text: string[] },
	) => ({
		data: [input.text[0].includes("PDF") ? [1, 0] : [0, 1]],
	})) as never);
});

async function createRoom() {
	const res = await SELF.fetch(origin + "/api/rooms", { method: "POST" });
	expect(res.status).toBe(201);
	return (await res.json()) as { id: string; token: string };
}

async function connect(id: string, voter: string, key?: string) {
	const res = await SELF.fetch(`${origin}/api/rooms/${id}/ws?v=${voter}${key ? "&k=" + key : ""}`, {
		headers: { Upgrade: "websocket" },
	});
	const ws = res.webSocket;
	if (!ws) return { status: res.status };
	const inbox: ServerMsg[] = [];
	let wake = () => {};
	ws.addEventListener("message", (e) => {
		inbox.push(JSON.parse(e.data as string));
		wake();
	});
	ws.accept();
	const next = async <T extends ServerMsg["t"]>(t: T) => {
		for (;;) {
			const i = inbox.findIndex((m) => m.t === t);
			if (i >= 0) return inbox.splice(i, 1)[0] as Extract<ServerMsg, { t: T }>;
			await new Promise<void>((r) => (wake = r));
		}
	};
	return { status: res.status, ws, next, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

it("없는 방은 404", async () => {
	expect((await SELF.fetch(origin + "/api/rooms/abcdef")).status).toBe(404);
	expect((await connect("abcdef", "voter-aaaa")).status).toBe(404);
});

it("발표자 토큰을 확인한다", async () => {
	const { id, token } = await createRoom();
	expect(await (await SELF.fetch(`${origin}/api/rooms/${id}?k=${token}`)).json()).toMatchObject({
		host: true,
	});
	expect(await (await SELF.fetch(`${origin}/api/rooms/${id}?k=wrong`)).json()).toMatchObject({
		host: false,
	});
	expect((await connect(id, "voter-aaaa", "wrong")).status).toBe(403);
});

it("질문, 추천, 발표자 상태 변경이 모두에게 전달된다", async () => {
	const { id, token } = await createRoom();
	const a = await connect(id, "voter-aaaa");
	const host = await connect(id, "voter-host", token);
	if (!a.ws || !host.ws) throw new Error("연결 실패");
	expect((await a.next("state")).host).toBe(false);
	expect((await host.next("state")).host).toBe(true);

	a.send({ t: "ask", text: "  PDF는   몇 MB까지 되나요? " });
	await a.next("asked");
	const q = (await host.next("q")).q;
	expect(q).toMatchObject({ text: "PDF는 몇 MB까지 되나요?", votes: 0, status: "open" });
	await a.next("q");

	a.send({ t: "ask", text: "바로 하나 더" });
	expect((await a.next("err")).code).toBe("slow");
	a.send({ t: "ask", text: "a" });
	expect((await a.next("err")).code).toBe("length");

	host.send({ t: "vote", id: q.id });
	expect((await host.next("mine")).mine).toBe(true);
	expect((await a.next("q")).q.votes).toBe(1);
	host.send({ t: "vote", id: q.id });
	expect((await host.next("mine")).mine).toBe(false);
	expect((await a.next("q")).q.votes).toBe(0);

	a.send({ t: "set", id: q.id, status: "hidden" });
	host.send({ t: "set", id: q.id, status: "live" });
	expect((await a.next("q")).q.status).toBe("live");
	host.send({ t: "set", id: q.id, status: "hidden" });
	expect((await a.next("del")).id).toBe(q.id);

	const late = await connect(id, "voter-late");
	if (!late.ws) throw new Error("연결 실패");
	expect((await late.next("state")).qs).toEqual([]);
});

it("발표자가 승인한 답만 청중에게 보인다", async () => {
	const { id, token } = await createRoom();
	const a = await connect(id, "voter-aaaa");
	const host = await connect(id, "voter-host", token);
	if (!a.ws || !host.ws) throw new Error("연결 실패");
	a.send({ t: "ask", text: "로그인해야 하나요?" });
	const q = (await host.next("q")).q;
	expect(q.answer).toBeUndefined();
	await a.next("q");

	a.send({ t: "approve", id: q.id, text: "청중이 승인할 수는 없다" });
	host.send({ t: "approve", id: q.id, text: "계정 없이 쓸 수 있습니다." });
	expect((await host.next("draft")).d).toMatchObject({ status: "ready", approved: true });
	expect((await a.next("q")).q.answer).toEqual({ text: "계정 없이 쓸 수 있습니다.", sources: [] });

	host.send({ t: "unapprove", id: q.id });
	expect((await a.next("q")).q.answer).toBeUndefined();
});

it("비슷한 질문을 묶고, 발표자가 분리하고 숨김을 되돌린다", async () => {
	const { id, token } = await createRoom();
	const a = await connect(id, "voter-aaaa");
	const b = await connect(id, "voter-bbbb");
	const host = await connect(id, "voter-host", token);
	if (!a.ws || !b.ws || !host.ws) throw new Error("연결 실패");

	a.send({ t: "ask", text: "PDF는 몇 MB까지 되나요?" });
	const first = (await host.next("q")).q;
	b.send({ t: "ask", text: "PDF 용량 제한이 있나요?" });
	const second = (await host.next("q")).q;
	expect((await host.next("del")).id).toBe(second.id);
	expect((await host.next("q")).q).toMatchObject({
		id: first.id,
		votes: 1,
		similar: [{ id: second.id, text: "PDF 용량 제한이 있나요?" }],
	});

	host.send({ t: "split", id: second.id });
	expect((await host.next("q")).q).toMatchObject({ id: second.id, votes: 0 });
	expect((await host.next("q")).q.similar).toBeUndefined();

	host.send({ t: "set", id: second.id, status: "hidden" });
	expect((await host.next("q")).q).toMatchObject({ id: second.id, status: "hidden" });
	host.send({ t: "set", id: second.id, status: "open" });
	expect((await host.next("q")).q).toMatchObject({ id: second.id, status: "open" });
});
