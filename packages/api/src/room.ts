import { DurableObject } from "cloudflare:workers";
import * as v from "valibot";
import {
	ClientMsgSchema,
	LIMITS,
	PROTOCOL_VERSION,
	VOTER_ID,
	instanceId,
	type Draft,
	type Opts,
	type Question,
	type RoomInfo,
	type ServerMsg,
	type Source,
	type Status,
} from "@anyq/protocol";
import { same, sha256 } from "./crypto.ts";

/** ok: hello를 마쳤다. 그 전에는 다른 메시지를 받지 않는다. */
type Attachment = { voter: string; host: boolean; ip: string; ok: boolean };
type QRow = {
	id: number;
	text: string;
	name: string | null;
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
	at: number | null;
};

const MAX_QUESTIONS = 300;
const ASK_INTERVAL_MS = 5000;
/** 한 IP에서 1분 동안. 발표장은 같은 IP를 쓰므로 넉넉하게 둔다. */
const IP_ASKS = 20;
const IP_VOTERS = 120;
const TTL_MS = 7 * 86_400_000;
const PENDING_MS = LIMITS.pendingMs;
const POLL_MS = 15_000;
const POLL_MAX_MS = 20 * 60_000;
const BACKFILL = 50;
const GUARD = "@cf/meta/llama-guard-3-8b";
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

/** 스키마 변경은 끝에 더하기만 한다. 적용한 개수를 meta.schema에 적는다. */
const MIGRATIONS = [
	`CREATE TABLE q (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		text TEXT NOT NULL,
		name TEXT,
		voter TEXT NOT NULL,
		ip TEXT,
		at INTEGER NOT NULL,
		status TEXT NOT NULL DEFAULT 'open',
		grp INTEGER,
		near INTEGER,
		vec BLOB
	);
	CREATE TABLE vote (
		qid INTEGER NOT NULL,
		voter TEXT NOT NULL,
		PRIMARY KEY (qid, voter)
	) WITHOUT ROWID;
	CREATE TABLE draft (
		qid INTEGER PRIMARY KEY,
		status TEXT NOT NULL,
		text TEXT NOT NULL DEFAULT '',
		sources TEXT NOT NULL DEFAULT '[]',
		approved INTEGER NOT NULL DEFAULT 0,
		at INTEGER
	);
	CREATE TABLE seen (
		voter TEXT PRIMARY KEY,
		ip TEXT NOT NULL,
		at INTEGER NOT NULL
	) WITHOUT ROWID;`,
];

export class Room extends DurableObject<Cloudflare.Env> {
	private sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		this.migrate();
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
	}

	private migrate() {
		this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
		const done = Number(this.meta("schema") ?? 0);
		MIGRATIONS.slice(done).forEach((sql, i) => {
			this.ctx.storage.transactionSync(() => {
				this.sql.exec(sql);
				this.setMeta("schema", String(done + i + 1));
			});
		});
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
	init(hash: string, id: string, owner: string | null): boolean {
		if (this.meta("host")) return false;
		this.setMeta("host", hash);
		this.setMeta("id", id);
		// 계정이 생기면 방 주인이 들어갈 자리. 지금은 늘 비어 있다.
		if (owner) this.setMeta("owner", owner);
		this.arm();
		return true;
	}

	/** 지울 날을 정한다. */
	private arm(): number {
		const expires = Date.now() + TTL_MS;
		this.setMeta("expires", String(expires));
		this.ctx.waitUntil(this.ctx.storage.setAlarm(expires));
		return expires;
	}

	/** 없는 방이면 null. */
	check(hash: string | null): RoomInfo | null {
		const stored = this.meta("host");
		if (!stored) return null;
		return {
			host: hash !== null && same(hash, stored),
			files: this.files(),
			expires: Number(this.meta("expires")),
		};
	}

	private opts(): Opts {
		return { review: this.meta("review") === "1", names: this.meta("names") !== "0" };
	}

	/** 자료가 하나 올라왔다. */
	addFile(): number {
		const n = this.files() + 1;
		this.setMeta("files", String(n));
		this.setMeta("indexed", this.meta("indexed") ?? "0");
		this.setMeta("poll", String(Date.now()));
		this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + POLL_MS));
		this.broadcast({ t: "files", n });
		return n;
	}

	/** 색인이 끝났는지 지켜보다가 초안을 채우고, 기한이 지나면 방을 지운다. */
	async alarm() {
		const now = Date.now();
		const expires = Number(this.meta("expires"));
		if (!expires) return;
		if (now >= expires) return this.destroy();
		const since = Number(this.meta("poll"));
		let again = false;
		if (since) {
			again = now - since < POLL_MAX_MS && (await this.indexing());
			if (!again) {
				this.sql.exec("DELETE FROM meta WHERE k = 'poll'");
				await this.backfill();
			}
		}
		await this.ctx.storage.setAlarm(again ? Math.min(now + POLL_MS, expires) : expires);
	}

	/** 아직 색인 중인 자료가 있으면 true. */
	private async indexing(): Promise<boolean> {
		try {
			const { result } = await this.env.AI_SEARCH.get(instanceId(this.meta("id") ?? "")).items.list(
				{
					per_page: 50,
				},
			);
			this.setMeta("indexed", String(result.filter((i) => i.status === "completed").length));
			return (
				result.length < this.files() ||
				result.some((i) => i.status === "queued" || i.status === "running")
			);
		} catch (e) {
			console.warn(JSON.stringify({ msg: "index_poll_failed", error: String(e) }));
			return true;
		}
	}

	/** 초안이 없거나 자료에서 못 찾았던 질문을 다시 찾는다. */
	private async backfill() {
		const rows = this.sql
			.exec<{ id: number; text: string }>(
				`SELECT q.id, q.text FROM q LEFT JOIN draft d ON d.qid = q.id
				WHERE q.grp IS NULL AND q.status IN ('open', 'live') AND (d.qid IS NULL OR (d.approved = 0
					AND (d.status IN ('none', 'error') OR (d.status = 'pending' AND COALESCE(d.at, 0) < ?))))
				ORDER BY q.id LIMIT ${BACKFILL}`,
				Date.now() - PENDING_MS,
			)
			.toArray();
		for (const r of rows) await this.makeDraft(r.id, r.text);
	}

	private async destroy() {
		const roomId = this.meta("id");
		if (roomId && this.files() > 0) {
			try {
				await this.env.AI_SEARCH.delete(instanceId(roomId));
			} catch (e) {
				console.warn(JSON.stringify({ msg: "instance_delete", room: roomId, error: String(e) }));
				// 이미 없는 것이 아니면 한 시간 뒤에 다시 지운다.
				if (!/not.?found/i.test(String(e)))
					return this.ctx.storage.setAlarm(Date.now() + 3_600_000);
			}
		}
		for (const ws of this.ctx.getWebSockets()) {
			try {
				ws.close(1001, "expired");
			} catch {
				// 이미 닫힘
			}
		}
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.deleteAll();
		this.migrate();
	}

	async fetch(request: Request): Promise<Response> {
		const stored = this.meta("host");
		if (!stored) return new Response(null, { status: 404 });
		const url = new URL(request.url);
		const voter = url.searchParams.get("v") ?? "";
		if (!VOTER_ID.test(voter)) return new Response(null, { status: 400 });
		// 새 추천인은 IP마다 정해진 수만 받는다.
		const ip = (await sha256(request.headers.get("CF-Connecting-IP") ?? "")).slice(0, 16);
		const now = Date.now();
		if (!this.sql.exec("SELECT 1 FROM seen WHERE voter = ?", voter).toArray().length) {
			const { n } = this.sql
				.exec<{ n: number }>(
					"SELECT COUNT(*) AS n FROM seen WHERE ip = ? AND at > ?",
					ip,
					now - 60_000,
				)
				.one();
			if (n >= IP_VOTERS) return new Response(null, { status: 429 });
			this.sql.exec("INSERT INTO seen (voter, ip, at) VALUES (?, ?, ?)", voter, ip, now);
		}

		const { 0: client, 1: server } = new WebSocketPair();
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({ voter, host: false, ip, ok: false } satisfies Attachment);
		return new Response(null, { status: 101, webSocket: client });
	}

	private sendState(ws: WebSocket, voter: string, host: boolean) {
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
		this.send(ws, {
			t: "state",
			host,
			qs: this.questions(host),
			mine: mine.map((r) => r.id),
			files: this.files(),
			opts: this.opts(),
			drafts,
		});
	}

	/** 묶음의 대표 질문만 돌려준다. 숨긴 질문과 묶기 후보는 발표자에게만 간다. */
	private questions(host: boolean): Question[] {
		const rows = this.sql
			.exec<QRow>(
				`SELECT q.id, q.text, q.name, q.status, q.grp, q.near, q.voter, d.text AS atext, d.sources AS asrc
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
				if (r.name) q.name = r.name;
				if (r.atext !== null)
					q.answer = {
						text: r.atext,
						sources: [...new Set((JSON.parse(r.asrc ?? "[]") as Source[]).map((s) => s.key))],
					};
				const similar = rows.filter((m) => m.id !== r.id && rep(m) === r.id);
				if (similar.length)
					q.similar = similar.map((m) => ({
						id: m.id,
						text: m.text,
						...(m.name ? { name: m.name } : {}),
					}));
				const near = host && r.near !== null ? byId.get(r.near) : undefined;
				const target = near && byId.get(rep(near));
				if (near && target && target.id !== r.id && target.status !== "hidden")
					q.near = { id: target.id, text: near.text, ...(near.name ? { name: near.name } : {}) };
				return q;
			});
	}

	private send(ws: WebSocket, msg: ServerMsg) {
		ws.send(JSON.stringify(msg));
	}

	private broadcast(msg: ServerMsg, to?: "host" | "aud") {
		const text = JSON.stringify(msg);
		for (const ws of this.ctx.getWebSockets()) {
			try {
				if (to && ((ws.deserializeAttachment() as Attachment).host ? "host" : "aud") !== to)
					continue;
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

	/** 문제가 될 질문이면 false. 확인에 실패하면 그대로 보여 준다. */
	private async safe(text: string): Promise<boolean> {
		try {
			const out = (await this.env.AI.run(GUARD, {
				messages: [{ role: "user", content: text }],
			})) as { response?: unknown };
			const r = out.response;
			return typeof r === "string"
				? !/^\s*unsafe/i.test(r)
				: (r as { safe?: boolean } | undefined)?.safe !== false;
		} catch (e) {
			console.warn(JSON.stringify({ msg: "guard_failed", error: String(e) }));
			return true;
		}
	}

	/** 새 질문은 숨긴 채로 들어온다. 검토 방이 아니고 확인을 통과하면 연다. */
	private async afterAsk(id: number, text: string, name: string | null, review: boolean) {
		// 이름도 화면에 나가므로 함께 확인한다.
		if (review || !(await this.safe(name ? name + ": " + text : text))) return this.publish(id);
		this.sql.exec("UPDATE q SET status = 'open' WHERE id = ? AND status = 'hidden'", id);
		this.publish(id);
		await this.process(id, text);
	}

	private async process(id: number, text: string) {
		if (await this.cluster(id, text)) return;
		// 색인된 자료가 아직 없으면 색인이 끝난 뒤 alarm이 채운다.
		if (Number(this.meta("indexed") ?? this.files()) > 0) await this.makeDraft(id, text);
	}

	private saveDraft(id: number, d: Omit<Draft, "approved">) {
		this.sql.exec(
			`INSERT INTO draft (qid, status, text, sources, at) VALUES (?1, ?2, ?3, ?4, ?5)
			ON CONFLICT (qid) DO UPDATE SET status = ?2, text = ?3, sources = ?4, at = ?5, approved = 0`,
			id,
			d.status,
			d.text,
			JSON.stringify(d.sources),
			Date.now(),
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
				.map((c) => ({ key: c.item.key, ...excerpt(c.text, text) }));
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

	async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
		if (typeof raw !== "string" || raw.length > 4000) return;
		const who = ws.deserializeAttachment() as Attachment;
		let json: unknown;
		try {
			json = JSON.parse(raw);
		} catch {
			return;
		}
		const parsed = v.safeParse(ClientMsgSchema, json);
		if (!parsed.success) {
			if (who.ok && (json as { t?: unknown } | null)?.t === "ask")
				this.send(ws, { t: "err", code: "length" });
			return;
		}
		const msg = parsed.output;

		if (msg.t === "hello") {
			// 웹과 API는 따로 배포된다. 오래된 화면은 새로 고치게 한다.
			if (msg.v !== PROTOCOL_VERSION) return this.send(ws, { t: "err", code: "version" });
			let host = false;
			if (msg.k !== undefined) {
				const stored = this.meta("host");
				host = !!stored && same(await sha256(msg.k), stored);
				if (!host) return this.send(ws, { t: "err", code: "key" });
			}
			ws.serializeAttachment({ ...who, host, ok: true } satisfies Attachment);
			return this.sendState(ws, who.voter, host);
		}
		if (!who.ok) return;

		if (msg.t === "opt") {
			if (!who.host) return;
			this.setMeta(msg.key, msg.on ? "1" : "0");
			return this.broadcast({ t: "opts", opts: this.opts() });
		}

		if (msg.t === "ask") {
			const { text } = msg;
			const name = msg.name || null;
			const now = Date.now();
			const last = this.sql
				.exec<{ at: number | null }>("SELECT MAX(at) AS at FROM q WHERE voter = ?", who.voter)
				.one().at;
			if (last && now - last < ASK_INTERVAL_MS) return this.send(ws, { t: "err", code: "slow" });
			const recent = this.sql
				.exec<{ n: number }>(
					"SELECT COUNT(*) AS n FROM q WHERE ip = ? AND at > ?",
					who.ip,
					now - 60_000,
				)
				.one().n;
			if (recent >= IP_ASKS) return this.send(ws, { t: "err", code: "slow" });
			const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM q").one().n;
			if (count >= MAX_QUESTIONS) return this.send(ws, { t: "err", code: "full" });
			const { id } = this.sql
				.exec<{ id: number }>(
					"INSERT INTO q (text, name, voter, at, ip, status) VALUES (?, ?, ?, ?, ?, 'hidden') RETURNING id",
					text,
					name,
					who.voter,
					now,
					who.ip,
				)
				.one();
			const { review } = this.opts();
			this.send(ws, { t: "asked", held: review });
			this.ctx.waitUntil(this.afterAsk(id, text, name, review));
			return;
		}

		const { id } = msg;

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

		if (msg.t === "set") {
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
			this.publish(id);
			// 숨긴 채로 들어온 질문은 열 때 묶기와 초안을 처리한다.
			const fresh =
				q.status === "hidden" &&
				msg.status !== "hidden" &&
				this.sql.exec("SELECT 1 FROM q WHERE id = ? AND vec IS NULL", id).toArray().length > 0;
			if (fresh) this.ctx.waitUntil(this.process(id, q.text));
			return;
		}

		if (msg.t === "merge") {
			const into = all.find((x) => x.id === msg.into);
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
			this.sql.exec(
				`INSERT INTO draft (qid, status, text, approved) VALUES (?1, 'ready', ?2, 1)
				ON CONFLICT (qid) DO UPDATE SET status = 'ready', text = ?2, approved = 1`,
				id,
				msg.text,
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
function excerpt(chunk: string, answer: string): { text: string; at?: string } {
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
	const text = lines
		.slice(Math.max(0, best - 1), best + 2)
		.join("\n")
		.slice(0, 500);
	// 그 줄 위에서 가장 가까운 마크다운 제목
	const at = lines
		.slice(0, best + 1)
		.findLast((l) => /^#{1,6}\s/.test(l))
		?.replace(/^#+\s*/, "")
		.slice(0, 80);
	return at ? { text, at } : { text };
}

function unit(v: number[]): Float32Array {
	const n = Math.hypot(...v) || 1;
	return Float32Array.from(v, (x) => x / n);
}

function dot(a: Float32Array, b: Float32Array): number {
	let s = 0;
	for (let i = 0; i < a.length && i < b.length; i++) s += a[i]! * b[i]!;
	return s;
}

function toDraft(row: DRow): Draft {
	// 만들다 멈춘 초안은 실패로 보여 준다.
	const stale = row.status === "pending" && Date.now() - (row.at ?? 0) > PENDING_MS;
	return {
		status: stale ? "error" : row.status,
		text: row.text,
		sources: JSON.parse(row.sources),
		approved: row.approved === 1,
	};
}
