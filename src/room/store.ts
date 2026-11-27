// 방 화면의 상태와 서버 연결. 화면 하나에 방 하나라 모듈에 둔다.
import { computed, signal } from "@preact/signals";
import {
	LIMITS,
	PROTOCOL_VERSION,
	type ClientMsg,
	type Draft,
	type FileItem,
	type Opts,
	type Question,
	type ServerMsg,
} from "@anyq/protocol";
import { api } from "../client/api.ts";
import { loadTurnstile } from "../client/turnstile.ts";
import { getLang, getTheme, onLang, t } from "../client/ui.ts";

export type Role = "host" | "screen" | "audience";
type Conn = { key: string; kind: "ok" | "ing" | "bad" };

export let roomId = "";
export let role: Role = "audience";
/** 발표자 키는 # 뒤에 둔다. 서버로 가지 않아 로그에 남지 않는다. */
export let key: string | null = null;

export const qs = signal<ReadonlyMap<number, Question>>(new Map());
export const mine = signal<ReadonlySet<number>>(new Set());
export const drafts = signal<ReadonlyMap<number, Draft>>(new Map());
export const files = signal(0);
export const fileItems = signal<FileItem[]>([]);
export const fileNote = signal<string | null>("mat.empty");
export const opts = signal<Opts>({ review: false, names: true, auto: true });
export const expires = signal(0);
export const conn = signal<Conn>({ key: "conn.ing", kind: "ing" });
/** 목록 대신 보여 줄 안내. null이면 목록을 보여 준다. */
export const notice = signal<string | null>("msg.loading");
export const ready = signal(false);
export const askErr = signal<string | null>(null);
/** 질문이 접수될 때마다 오른다. 입력칸을 비우는 신호. */
export const asked = signal(0);
/** 화면 낭독기에 읽어 줄 말 */
export const live = signal("");
/** 발표자가 쓰던 답변. 다시 그려도 남는다. */
export const edits = new Map<number, string>();

// 언어가 바뀌면 t()를 쓴 곳을 다시 그린다.
const lang = signal(0);
onLang(() => lang.value++);
export const tr = (k: string, ...args: unknown[]) => (lang.value, t(k, ...args));

// 오래 "작성 중"인 초안은 실패로 본다.
const pendAt = new Map<number, number>();
const tick = signal(0);
export const stale = (id: number) =>
	(tick.value, drafts.value.get(id)?.status === "pending") &&
	Date.now() - (pendAt.get(id) ?? 0) > LIMITS.pendingMs;

const sorted = computed(() =>
	[...qs.value.values()].sort(
		(a, b) =>
			// 프로젝터에서는 답변 중인 질문이 맨 위
			(role === "screen" ? Number(b.status === "live") - Number(a.status === "live") : 0) ||
			Number(a.status === "done") - Number(b.status === "done") ||
			b.votes - a.votes ||
			a.id - b.id,
	),
);
export const shown = computed(() => sorted.value.filter((q) => q.status !== "hidden"));
export const hidden = computed(() => sorted.value.filter((q) => q.status === "hidden"));

let ws: WebSocket | undefined;
let retry = 0;
let pinger: ReturnType<typeof setInterval> | undefined;
let stopped = false;

/** 사람 확인이 끝나면 다시 보낼 질문·추천 */
let held: ClientMsg | undefined;
let verifying = false;

export function send(m: ClientMsg) {
	if (m.t === "ask" || m.t === "vote") held = m;
	if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
	else conn.value = { key: "conn.nosend", kind: "bad" };
}

function setDraft(map: Map<number, Draft>, id: number, d: Draft) {
	map.set(id, d);
	if (d.status !== "pending") return void pendAt.delete(id);
	pendAt.set(id, Date.now());
	setTimeout(() => tick.value++, LIMITS.pendingMs + 500);
}

function onMessage(m: ServerMsg) {
	switch (m.t) {
		case "state": {
			const d = new Map<number, Draft>();
			for (const [k, v] of Object.entries(m.drafts)) setDraft(d, Number(k), v);
			qs.value = new Map(m.qs.map((q) => [q.id, q]));
			mine.value = new Set(m.mine);
			drafts.value = d;
			opts.value = m.opts;
			setFiles(m.files);
			ready.value = true;
			notice.value = null;
			return;
		}
		case "q": {
			if (!qs.value.has(m.q.id) && role !== "audience") live.value = t("sr.new", m.q.text);
			qs.value = new Map(qs.value).set(m.q.id, m.q);
			return;
		}
		case "del": {
			const next = new Map(qs.value);
			next.delete(m.id);
			qs.value = next;
			return;
		}
		case "draft": {
			const next = new Map(drafts.value);
			setDraft(next, m.id, m.d);
			if (m.d.status !== "pending") edits.delete(m.id);
			drafts.value = next;
			return;
		}
		case "mine": {
			const next = new Set(mine.value);
			if (m.mine) next.add(m.id);
			else next.delete(m.id);
			mine.value = next;
			return;
		}
		case "files":
			return setFiles(m.n);
		case "opts":
			opts.value = m.opts;
			return;
		case "asked":
			asked.value++;
			askErr.value = m.held ? "asked.held" : null;
			live.value = t("sr.asked");
			return;
		case "err":
			if (m.code === "key") conn.value = { key: "conn.key", kind: "bad" };
			else if (m.code === "version") {
				// 웹이 API보다 오래됐다. 다시 붙어도 같으므로 멈춘다.
				stopped = true;
				conn.value = { key: "conn.version", kind: "bad" };
				notice.value = "msg.version";
				ws?.close();
			} else if (m.code === "verify") void verify();
			else askErr.value = "err." + m.code;
	}
}

/** 서버가 사람 확인을 요구하면 Turnstile을 거친 뒤 하던 일을 다시 보낸다. */
async function verify() {
	const slot = document.getElementById("ts");
	if (verifying || !slot) return;
	verifying = true;
	const done = (err: string | null = null) => {
		verifying = false;
		slot.replaceChildren();
		askErr.value = err;
	};
	try {
		const { sitekey } = await api.config();
		await loadTurnstile();
		window.turnstile!.render(slot, {
			sitekey,
			theme: getTheme(),
			language: getLang(),
			appearance: "interaction-only",
			action: "join",
			"refresh-expired": "never",
			callback: async (token: string) => {
				try {
					await api.join(roomId, voter(), token);
					done();
					if (held) send(held);
				} catch {
					done("err.turnstile");
				}
			},
			"error-callback": () => done("err.turnstile"),
		});
	} catch {
		done("err.net");
	}
}

function connect() {
	const sock = (ws = new WebSocket(api.wsUrl(roomId, voter())));
	sock.onopen = () => {
		retry = 0;
		conn.value = { key: "conn.ok", kind: "ok" };
		sock.send(
			JSON.stringify({
				t: "hello",
				v: PROTOCOL_VERSION,
				...(role === "host" && key ? { k: key } : {}),
			} satisfies ClientMsg),
		);
		clearInterval(pinger);
		pinger = setInterval(() => sock.readyState === WebSocket.OPEN && sock.send("ping"), 30000);
	};
	sock.onmessage = (e) => {
		if (e.data !== "pong") onMessage(JSON.parse(e.data));
	};
	sock.onclose = () => {
		clearInterval(pinger);
		if (stopped) return;
		conn.value = { key: "conn.lost", kind: "bad" };
		setTimeout(connect, Math.min(8000, 1000 * 2 ** retry++));
	};
}

function voter(): string {
	let v = localStorage.getItem("anyq-voter");
	if (!v) localStorage.setItem("anyq-voter", (v = crypto.randomUUID()));
	return v;
}

// ---- 발표 자료 (발표자)
let fileTimer: ReturnType<typeof setTimeout> | undefined;

function setFiles(n: number) {
	const changed = n !== files.value;
	files.value = n;
	if (role === "host" && changed) void refreshFiles();
}

export async function refreshFiles() {
	clearTimeout(fileTimer);
	if (!files.value) {
		fileItems.value = [];
		fileNote.value = "mat.empty";
		return;
	}
	try {
		const items = await api.files(roomId, key);
		const busy =
			items.some((f) => f.status === "queued" || f.status === "running") ||
			items.length < files.value;
		fileItems.value = items;
		fileNote.value = busy ? "mat.busy" : null;
		if (busy) fileTimer = setTimeout(refreshFiles, 3000);
	} catch {
		fileNote.value = "mat.listfail";
		fileTimer = setTimeout(refreshFiles, 5000);
	}
}

/** 올리지 못하면 안내 문구의 키를 돌려준다. */
export async function upload(file: File): Promise<string | null> {
	try {
		const res = await api.upload(roomId, key, file);
		if (res.ok) return null;
		return [403, 413, 415].includes(res.status) ? "up." + res.status : "up.fail";
	} catch {
		return "up.fail";
	}
}

export async function start(id: string, r: Role) {
	roomId = id;
	role = r;
	key = new URLSearchParams(location.hash.slice(1)).get("k");
	// 방이 있는지는 서버가 화면을 그리기 전에 확인했다. 발표자 키만 여기서 확인한다.
	if (role === "host") {
		try {
			const info = await api.room(id, key);
			if (!info.host) {
				conn.value = { key: "conn.key", kind: "bad" };
				notice.value = "msg.key";
				return;
			}
			expires.value = info.expires;
			files.value = info.files;
			void refreshFiles();
		} catch {
			conn.value = { key: "conn.fail", kind: "bad" };
			notice.value = "msg.fail";
			return;
		}
	}
	ready.value = false;
	connect();
}
