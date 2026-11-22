import { DurableObject } from "cloudflare:workers";
import { sha256 } from "./index.ts";
import {
	VOTER_ID,
	instanceId,
	type ClientMsg,
	type Draft,
	type Question,
	type ServerMsg,
	type Source,
	type Status,
} from "./protocol.ts";

type Attachment = { voter: string; host: boolean };
type QRow = {
	id: number;
	text: string;
	status: Status;
	votes: number;
	atext: string | null;
	asrc: string | null;
};
type DRow = {
	qid: number;
	status: Draft["status"];
	text: string;
	sources: string;
	approved: number;
};

const MAX_QUESTIONS = 300;
const ASK_INTERVAL_MS = 5000;
const STATUSES: Status[] = ["open", "live", "done", "hidden"];
const MODEL = "@cf/openai/gpt-oss-120b";
const SYSTEM = [
	"너는 발표자를 대신해 청중 질문에 대한 답변 초안을 쓴다.",
	"함께 주어진 발표 자료 내용만 근거로, 한국어 존댓말 두세 문장으로 답한다.",
	"자료에 답이 없으면 다른 말 없이 NONE 이라고만 쓴다.",
	"추측하지 않고 자료 밖 지식을 쓰지 않는다. 머리말, 목록, 마크다운을 쓰지 않는다.",
].join(" ");

function same(a: string, b: string): boolean {
	const x = new TextEncoder().encode(a);
	const y = new TextEncoder().encode(b);
	return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}

export class Room extends DurableObject<Cloudflare.Env> {
	private sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS q (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				text TEXT NOT NULL,
				voter TEXT NOT NULL,
				at INTEGER NOT NULL,
				status TEXT NOT NULL DEFAULT 'open'
			);
			CREATE TABLE IF NOT EXISTS vote (
				qid INTEGER NOT NULL,
				voter TEXT NOT NULL,
				PRIMARY KEY (qid, voter)
			) WITHOUT ROWID;
			CREATE TABLE IF NOT EXISTS draft (
				qid INTEGER PRIMARY KEY,
				status TEXT NOT NULL,
				text TEXT NOT NULL DEFAULT '',
				sources TEXT NOT NULL DEFAULT '[]',
				approved INTEGER NOT NULL DEFAULT 0
			);
		`);
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
	}

	private meta(k: string): string | null {
		return (
			this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = ?", k).toArray()[0]?.v ?? null
		);
	}

	private setMeta(k: string, v: string) {
		this.sql.exec(
			"INSERT INTO meta (k, v) VALUES (?1, ?2) ON CONFLICT (k) DO UPDATE SET v = ?2",
			k,
			v,
		);
	}

	private files(): number {
		return Number(this.meta("files") ?? 0);
	}

	/** 방을 연다. 이미 열린 방이면 false. */
	init(hash: string, id: string): boolean {
		if (this.meta("host")) return false;
		this.setMeta("host", hash);
		this.setMeta("id", id);
		return true;
	}

	/** 없는 방이면 null. */
	check(hash: string | null): { host: boolean; files: number } | null {
		const stored = this.meta("host");
		if (!stored) return null;
		return { host: hash !== null && same(hash, stored), files: this.files() };
	}

	/** 자료가 하나 올라왔다. */
	addFile(): number {
		const n = this.files() + 1;
		this.setMeta("files", String(n));
		this.broadcast({ t: "files", n });
		return n;
	}

	async fetch(request: Request): Promise<Response> {
		const stored = this.meta("host");
		if (!stored) return new Response(null, { status: 404 });
		const url = new URL(request.url);
		const voter = url.searchParams.get("v") ?? "";
		if (!VOTER_ID.test(voter)) return new Response(null, { status: 400 });
		const key = url.searchParams.get("k");
		const host = key !== null && same(await sha256(key), stored);
		if (key !== null && !host) return new Response(null, { status: 403 });

		const { 0: client, 1: server } = new WebSocketPair();
		this.ctx.acceptWebSocket(server, host ? ["host"] : []);
		server.serializeAttachment({ voter, host } satisfies Attachment);
		const mine = this.sql
			.exec<{ qid: number }>("SELECT qid FROM vote WHERE voter = ?", voter)
			.toArray();
		const drafts: Record<number, Draft> = {};
		if (host)
			for (const row of this.sql.exec<DRow>("SELECT * FROM draft").toArray())
				drafts[row.qid] = toDraft(row);
		this.send(server, {
			t: "state",
			host,
			qs: this.questions(),
			mine: mine.map((r) => r.qid),
			files: this.files(),
			drafts,
		});
		return new Response(null, { status: 101, webSocket: client });
	}

	private questions(id?: number): Question[] {
		const where = id === undefined ? "q.status != 'hidden'" : "q.id = ?";
		return this.sql
			.exec<QRow>(
				`SELECT q.id, q.text, q.status, (SELECT COUNT(*) FROM vote WHERE qid = q.id) AS votes,
					d.text AS atext, d.sources AS asrc
				FROM q LEFT JOIN draft d ON d.qid = q.id AND d.approved = 1 WHERE ${where}`,
				...(id === undefined ? [] : [id]),
			)
			.toArray()
			.map(({ atext, asrc, ...q }) =>
				atext === null
					? q
					: {
							...q,
							answer: {
								text: atext,
								sources: [...new Set((JSON.parse(asrc ?? "[]") as Source[]).map((s) => s.key))],
							},
						},
			);
	}

	private send(ws: WebSocket, msg: ServerMsg) {
		ws.send(JSON.stringify(msg));
	}

	private broadcast(msg: ServerMsg, tag?: string) {
		const text = JSON.stringify(msg);
		for (const ws of this.ctx.getWebSockets(tag)) {
			try {
				ws.send(text);
			} catch {
				// 닫히는 중인 소켓
			}
		}
	}

	private publish(id: number) {
		const q = this.questions(id)[0];
		if (!q || q.status === "hidden") this.broadcast({ t: "del", id });
		else this.broadcast({ t: "q", q });
	}

	private saveDraft(id: number, d: Omit<Draft, "approved">) {
		this.sql.exec(
			`INSERT INTO draft (qid, status, text, sources) VALUES (?1, ?2, ?3, ?4)
			ON CONFLICT (qid) DO UPDATE SET status = ?2, text = ?3, sources = ?4, approved = 0`,
			id,
			d.status,
			d.text,
			JSON.stringify(d.sources),
		);
		this.broadcast({ t: "draft", id, d: { ...d, approved: false } }, "host");
	}

	/** 자료에서 답변 초안을 찾는다. 승인 전에는 발표자에게만 보낸다. */
	private async makeDraft(id: number, question: string) {
		const roomId = this.meta("id");
		if (!roomId) return;
		this.saveDraft(id, { status: "pending", text: "", sources: [] });
		try {
			const res = await this.env.AI_SEARCH.get(instanceId(roomId)).chatCompletions({
				model: MODEL,
				messages: [
					{ role: "system", content: SYSTEM },
					{ role: "user", content: question },
				],
				ai_search_options: { retrieval: { max_num_results: 4 } },
			});
			const text = (res.choices[0]?.message.content ?? "").trim();
			const sources = res.chunks
				.slice(0, 2)
				.map((c) => ({ key: c.item.key, text: excerpt(c.text, text) }));
			if (!sources.length || !text || /^NONE\b/i.test(text))
				this.saveDraft(id, { status: "none", text: "", sources: [] });
			else this.saveDraft(id, { status: "ready", text, sources });
		} catch (e) {
			console.error(
				JSON.stringify({ msg: "draft_failed", room: roomId, qid: id, error: String(e) }),
			);
			this.saveDraft(id, { status: "error", text: "", sources: [] });
		}
		this.publish(id);
	}

	webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
		if (typeof raw !== "string" || raw.length > 4000) return;
		let msg: ClientMsg;
		try {
			msg = JSON.parse(raw);
		} catch {
			return;
		}
		const who = ws.deserializeAttachment() as Attachment;

		if (msg.t === "ask") {
			const text = String(msg.text ?? "")
				.replace(/\s+/g, " ")
				.trim();
			if (text.length < 2 || text.length > 200) return this.send(ws, { t: "err", code: "length" });
			const now = Date.now();
			const last = this.sql
				.exec<{ at: number | null }>("SELECT MAX(at) AS at FROM q WHERE voter = ?", who.voter)
				.one().at;
			if (last && now - last < ASK_INTERVAL_MS) return this.send(ws, { t: "err", code: "slow" });
			const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM q").one().n;
			if (count >= MAX_QUESTIONS) return this.send(ws, { t: "err", code: "full" });
			const { id } = this.sql
				.exec<{ id: number }>(
					"INSERT INTO q (text, voter, at) VALUES (?, ?, ?) RETURNING id",
					text,
					who.voter,
					now,
				)
				.one();
			this.send(ws, { t: "asked" });
			this.publish(id);
			if (this.files() > 0) this.ctx.waitUntil(this.makeDraft(id, text));
			return;
		}

		const id = Number(msg.id);
		if (!Number.isInteger(id)) return;
		const q = this.questions(id)[0];
		if (!q || q.status === "hidden") return;

		if (msg.t === "vote") {
			if (q.status === "done") return;
			const removed = this.sql
				.exec("DELETE FROM vote WHERE qid = ? AND voter = ? RETURNING qid", id, who.voter)
				.toArray().length;
			if (!removed) this.sql.exec("INSERT INTO vote (qid, voter) VALUES (?, ?)", id, who.voter);
			this.send(ws, { t: "mine", id, mine: !removed });
			return this.publish(id);
		}

		if (!who.host) return;

		if (msg.t === "set" && STATUSES.includes(msg.status)) {
			const wasLive =
				msg.status === "live"
					? this.sql
							.exec<{ id: number }>("SELECT id FROM q WHERE status = 'live' AND id != ?", id)
							.toArray()
					: [];
			this.sql.exec(
				"UPDATE q SET status = 'open' WHERE status = 'live' AND ?1 = 'live'",
				msg.status,
			);
			this.sql.exec("UPDATE q SET status = ? WHERE id = ?", msg.status, id);
			for (const row of wasLive) this.publish(row.id);
			return this.publish(id);
		}

		if (msg.t === "draft") {
			if (this.files() > 0) this.ctx.waitUntil(this.makeDraft(id, q.text));
			return;
		}

		if (msg.t === "approve") {
			const text = String(msg.text ?? "").trim();
			if (!text || text.length > 1000) return;
			this.sql.exec(
				`INSERT INTO draft (qid, status, text, approved) VALUES (?1, 'ready', ?2, 1)
				ON CONFLICT (qid) DO UPDATE SET status = 'ready', text = ?2, approved = 1`,
				id,
				text,
			);
		} else if (msg.t === "unapprove") {
			this.sql.exec("UPDATE draft SET approved = 0 WHERE qid = ?", id);
		} else return;
		const row = this.sql.exec<DRow>("SELECT * FROM draft WHERE qid = ?", id).toArray()[0];
		if (row) this.broadcast({ t: "draft", id, d: toDraft(row) }, "host");
		this.publish(id);
	}

	webSocketClose(ws: WebSocket) {
		try {
			ws.close(1000);
		} catch {
			// 이미 닫힘
		}
	}
}

/** 청크에서 답변과 낱말이 가장 많이 겹치는 줄과 그 앞뒤 줄만 보여 준다. */
function excerpt(chunk: string, answer: string): string {
	const lines = chunk
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	const words = new Set(answer.match(/[\p{L}\p{N}]{2,}/gu) ?? []);
	let best = 0;
	let bestScore = -1;
	lines.forEach((line, i) => {
		let score = 0;
		for (const w of words) if (line.includes(w)) score++;
		if (score > bestScore) [best, bestScore] = [i, score];
	});
	return lines
		.slice(Math.max(0, best - 1), best + 2)
		.join("\n")
		.slice(0, 500);
}

function toDraft(row: DRow): Draft {
	return {
		status: row.status,
		text: row.text,
		sources: JSON.parse(row.sources),
		approved: row.approved === 1,
	};
}
