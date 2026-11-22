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
	grp: number | null;
	near: number | null;
	voter: string;
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
const EMBED = "@cf/baai/bge-m3";
/** 코사인 유사도. AUTO 이상이면 바로 묶고, NEAR 이상이면 발표자에게 후보로 보여 준다. */
const AUTO = 0.9;
const NEAR = 0.7;
const SYSTEM = [
	"너는 발표자를 대신해 청중 질문에 대한 답변 초안을 쓴다.",
	"함께 주어진 발표 자료 내용만 근거로, 질문과 같은 언어로 두세 문장으로 답한다. 한국어면 존댓말을 쓴다.",
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
		// 묶기용 열. 이미 있으면 넘어간다.
		for (const col of ["grp INTEGER", "near INTEGER", "vec BLOB"]) {
			try {
				this.sql.exec("ALTER TABLE q ADD COLUMN " + col);
			} catch {
				// 이미 있음
			}
		}
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
		this.ctx.acceptWebSocket(server, [host ? "host" : "aud"]);
		server.serializeAttachment({ voter, host } satisfies Attachment);
		const mine = this.sql
			.exec<{ id: number }>(
				"SELECT DISTINCT COALESCE(q.grp, q.id) AS id FROM vote JOIN q ON q.id = vote.qid WHERE vote.voter = ?",
				voter,
			)
			.toArray();
		const drafts: Record<number, Draft> = {};
		if (host)
			for (const row of this.sql.exec<DRow>("SELECT * FROM draft").toArray())
				drafts[row.qid] = toDraft(row);
		this.send(server, {
			t: "state",
			host,
			qs: this.questions(host),
			mine: mine.map((r) => r.id),
			files: this.files(),
			drafts,
		});
		return new Response(null, { status: 101, webSocket: client });
	}

	/** 묶음의 대표 질문만 돌려준다. 숨긴 질문과 묶기 후보는 발표자에게만 간다. */
	private questions(host: boolean): Question[] {
		const rows = this.sql
			.exec<QRow>(
				`SELECT q.id, q.text, q.status, q.grp, q.near, q.voter, d.text AS atext, d.sources AS asrc
				FROM q LEFT JOIN draft d ON d.qid = q.id AND d.approved = 1 ORDER BY q.id`,
			)
			.toArray();
		const byId = new Map(rows.map((r) => [r.id, r]));
		const rep = (r: QRow) => (r.grp !== null && byId.has(r.grp) ? r.grp : r.id);
		// 추천 수: 묶음 전체에서 겹치지 않는 사람 수. 묶인 질문을 올린 사람도 한 표로 센다.
		const voters = new Map<number, Set<string>>();
		const count = (id: number, voter: string) =>
			voters.set(id, (voters.get(id) ?? new Set()).add(voter));
		for (const r of rows) if (rep(r) !== r.id) count(rep(r), r.voter);
		for (const v of this.sql.exec<{ qid: number; voter: string }>("SELECT qid, voter FROM vote")) {
			const r = byId.get(v.qid);
			if (r) count(rep(r), v.voter);
		}
		return rows
			.filter((r) => rep(r) === r.id && (host || r.status !== "hidden"))
			.map((r) => {
				const q: Question = {
					id: r.id,
					text: r.text,
					status: r.status,
					votes: voters.get(r.id)?.size ?? 0,
				};
				if (r.atext !== null)
					q.answer = {
						text: r.atext,
						sources: [...new Set((JSON.parse(r.asrc ?? "[]") as Source[]).map((s) => s.key))],
					};
				const similar = rows.filter((m) => m.id !== r.id && rep(m) === r.id);
				if (similar.length) q.similar = similar.map((m) => ({ id: m.id, text: m.text }));
				const near = host && r.near !== null ? byId.get(r.near) : undefined;
				const target = near && byId.get(rep(near));
				if (near && target && target.id !== r.id && target.status !== "hidden")
					q.near = { id: target.id, text: near.text };
				return q;
			});
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

	/** id가 속한 묶음의 대표 질문을 다시 보낸다. */
	private publish(id: number) {
		const grp = this.sql
			.exec<{ grp: number | null }>("SELECT grp FROM q WHERE id = ?", id)
			.toArray()[0]?.grp;
		const q = this.questions(true).find((x) => x.id === (grp ?? id));
		if (!q) return this.broadcast({ t: "del", id });
		this.broadcast({ t: "q", q }, "host");
		if (q.status === "hidden") return this.broadcast({ t: "del", id: q.id }, "aud");
		const { near: _, ...pub } = q;
		this.broadcast({ t: "q", q: pub }, "aud");
	}

	/** 새 질문을 이미 있는 질문과 비교한다. 묶었으면 true. */
	private async cluster(id: number, text: string): Promise<boolean> {
		try {
			const out = await this.env.AI.run(EMBED, { text: [text] });
			const raw = "data" in out ? out.data?.[0] : undefined;
			if (!raw) return false;
			const vec = unit(raw);
			this.sql.exec("UPDATE q SET vec = ? WHERE id = ?", vec.buffer, id);
			let best: { id: number; rep: number; status: Status } | undefined;
			let score = 0;
			for (const c of this.sql.exec<{ id: number; rep: number; status: Status; vec: ArrayBuffer }>(
				`SELECT c.id, r.id AS rep, r.status, c.vec FROM q c JOIN q r ON r.id = COALESCE(c.grp, c.id)
				WHERE c.id != ? AND c.vec IS NOT NULL AND r.status != 'hidden'`,
				id,
			)) {
				const s = dot(vec, new Float32Array(c.vec));
				if (s > score) [best, score] = [c, s];
			}
			if (!best) return false;
			console.log(JSON.stringify({ msg: "similar", qid: id, to: best.id, score }));
			if (score < NEAR) return false;
			if (score >= AUTO && (best.status === "open" || best.status === "live")) {
				this.sql.exec("UPDATE q SET grp = ? WHERE id = ?", best.rep, id);
				this.broadcast({ t: "del", id });
				this.publish(best.rep);
				return true;
			}
			this.sql.exec("UPDATE q SET near = ? WHERE id = ?", best.id, id);
			this.publish(id);
		} catch (e) {
			console.warn(JSON.stringify({ msg: "cluster_failed", qid: id, error: String(e) }));
		}
		return false;
	}

	private async afterAsk(id: number, text: string) {
		if (!(await this.cluster(id, text)) && this.files() > 0) await this.makeDraft(id, text);
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
			this.ctx.waitUntil(this.afterAsk(id, text));
			return;
		}

		const id = Number(msg.id);
		if (!Number.isInteger(id)) return;

		if (msg.t === "split") {
			if (!who.host) return;
			const old = this.sql
				.exec<{ grp: number | null }>("SELECT grp FROM q WHERE id = ?", id)
				.toArray()[0]?.grp;
			if (old == null) return;
			this.sql.exec("UPDATE q SET grp = NULL, near = NULL WHERE id = ?", id);
			this.publish(id);
			return this.publish(old);
		}

		const all = this.questions(true);
		const q = all.find((x) => x.id === id);
		if (!q) return;
		// 숨긴 질문은 발표자가 되돌리는 것만 된다.
		if (q.status === "hidden" && !(who.host && msg.t === "set")) return;

		if (msg.t === "vote") {
			if (q.status === "done") return;
			const ids = [id, ...(q.similar ?? []).map((s) => s.id)];
			const removed = this.sql
				.exec(
					`DELETE FROM vote WHERE voter = ? AND qid IN (${ids.join(",")}) RETURNING qid`,
					who.voter,
				)
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

		if (msg.t === "merge") {
			const into = all.find((x) => x.id === Number(msg.into));
			if (!into || into.id === id || into.status === "hidden") return;
			this.sql.exec("UPDATE q SET grp = ?1, near = NULL WHERE id = ?2 OR grp = ?2", into.id, id);
			this.broadcast({ t: "del", id });
			return this.publish(into.id);
		}

		if (msg.t === "keep") {
			this.sql.exec("UPDATE q SET near = NULL WHERE id = ?", id);
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

function unit(v: number[]): Float32Array {
	const n = Math.hypot(...v) || 1;
	return Float32Array.from(v, (x) => x / n);
}

function dot(a: Float32Array, b: Float32Array): number {
	let s = 0;
	for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i];
	return s;
}

function toDraft(row: DRow): Draft {
	return {
		status: row.status,
		text: row.text,
		sources: JSON.parse(row.sources),
		approved: row.approved === 1,
	};
}
