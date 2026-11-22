import qrcode from "qrcode-generator";
import { getLang, icon, onLang, t } from "./ui.js";

const [, , id, view] = location.pathname.split("/");
const role = view === "host" ? "host" : view === "screen" ? "screen" : "audience";
document.body.dataset.role = role;
// 발표자 키는 # 뒤에 둔다. 서버로 가지 않아 로그에 남지 않는다.
const key = new URLSearchParams(location.hash.slice(1)).get("k");
const auth = key ? { authorization: "Bearer " + key } : {};
const PENDING_MS = 90000;
const audienceUrl = location.origin + "/r/" + id;

const $ = (s) => document.getElementById(s);
const list = $("qs"),
	msg = $("msg"),
	conn = $("conn"),
	live = $("live"),
	total = $("total");
const form = $("ask"),
	input = $("q"),
	err = $("q-err");

let voter = localStorage.getItem("anyq-voter");
if (!voter) localStorage.setItem("anyq-voter", (voter = crypto.randomUUID()));

/** @type {Map<number, {id:number,text:string,votes:number,status:string}>} */
const qs = new Map();
const mine = new Set();
const drafts = new Map();
const edits = new Map();
const pendAt = new Map();
let files = 0,
	review = false,
	expires = 0;
let ws,
	retry = 0,
	ready = false,
	pinger;

const ACTIONS = {
	open: [
		["live", "play", "act.live"],
		["done", "check", "act.done"],
		["hidden", "eyeoff", "act.hide"],
	],
	live: [
		["done", "check", "act.done"],
		["open", "undo", "act.cancel"],
	],
	done: [
		["open", "undo", "act.reopen"],
		["hidden", "eyeoff", "act.hide"],
	],
};

function el(tag, props = {}, ...children) {
	const node = Object.assign(document.createElement(tag), props);
	node.append(...children);
	return node;
}

let msgKey = null;
function showMessage(k) {
	msgKey = k ?? null;
	msg.replaceChildren(...(k === "msg.loading" ? [icon("spin"), " "] : []), k ? t(k) : "");
	msg.hidden = !k;
}

let connState = ["conn.ing", "ing"];
function setConn(k, kind) {
	connState = [k, kind];
	const ic = kind === "ok" ? "check" : kind === "ing" ? "spin" : "warn";
	conn.replaceChildren(
		icon(ic),
		...(kind === "ok" ? [id, el("span", { className: "sr", textContent: t(k) })] : [t(k)]),
	);
	conn.toggleAttribute("data-bad", kind === "bad");
}

function keyBtn(k, ic, label) {
	const b = el("button", { type: "button", className: "btn" }, icon(ic), t(label));
	b.dataset.key = k;
	return b;
}

// 질문마다 노드를 두고 바뀐 조각만 다시 만든다.
// 통째로 다시 그리면 한글 조합이 끊기고 글자 크기 전환이 보이지 않는다.
const nodes = new Map();
const openSim = new Set();

function slot(n, name, sig, build) {
	const s = (n.slots[name] ??= {});
	if (s.sig !== sig) Object.assign(s, { sig, node: build() });
	return s.node;
}

function sync(parent, want) {
	want.forEach((node, i) => {
		const at = parent.children[i] ?? null;
		if (at === node) return;
		// moveBefore는 포커스와 전환을 지킨다.
		if (parent.moveBefore && node.parentNode === parent) parent.moveBefore(node, at);
		else parent.insertBefore(node, at);
	});
	while (parent.children.length > want.length) parent.lastElementChild.remove();
}

function stale(id) {
	return drafts.get(id)?.status === "pending" && Date.now() - (pendAt.get(id) ?? 0) > PENDING_MS;
}

function item(q) {
	let n = nodes.get(q.id);
	if (!n) nodes.set(q.id, (n = { li: el("li"), text: el("p", { className: "qtext" }), slots: {} }));
	const { li, text } = n;
	const hiddenQ = q.status === "hidden";
	const voted = mine.has(q.id);
	const flat = role === "screen" || q.status === "done" || hiddenQ;
	li.className = q.status;
	if (role === "host") {
		li.tabIndex = -1;
		li.dataset.key = "li:" + q.id;
	}

	const lead = slot(n, "lead", [flat, q.votes, voted, q.text].join("|"), () => {
		const count = [icon("up"), el("b", { textContent: q.votes })];
		if (flat) return el("div", { className: "count" }, ...count);
		const b = el("button", { type: "button", className: "vote" }, ...count);
		b.dataset.key = "vote:" + q.id;
		b.setAttribute("aria-pressed", voted);
		b.setAttribute("aria-label", t("vote.label", t(voted ? "unvote" : "vote"), q.votes, q.text));
		return b;
	});

	const k = q.status === "done" || hiddenQ ? "0" : Math.sqrt(q.votes).toFixed(2);
	if (text.style.getPropertyValue("--k") !== k) text.style.setProperty("--k", k);
	slot(n, "text", q.status + "|" + q.text, () => {
		text.replaceChildren(q.text);
		if (q.status === "live") text.append(el("span", { className: "tag" }, t("live.tag")));
		if (q.status === "done")
			text.append(el("span", { className: "tag" }, icon("check"), " ", t("done.tag")));
	});

	const side = slot(n, "side", String(hiddenQ), () =>
		hiddenQ
			? el("div", { className: "acts side" }, keyBtn("set:" + q.id + ":open", "undo", "act.unhide"))
			: null,
	);

	const similar = slot(n, "similar", hiddenQ ? "" : JSON.stringify(q.similar ?? ""), () => {
		if (hiddenQ || !q.similar?.length) return null;
		const box = el(
			"details",
			{ className: "similar" },
			el("summary", {}, t("similar", q.similar.length)),
		);
		box.dataset.key = "sim:" + q.id;
		box.open = openSim.has(q.id);
		box.append(
			el(
				"ul",
				{},
				...q.similar.map((s) =>
					el(
						"li",
						{},
						el("span", { textContent: s.text }),
						...(role === "host" ? [keyBtn("split:" + s.id, "split", "split")] : []),
					),
				),
			),
		);
		return box;
	});

	const showNear = role === "host" && !hiddenQ && q.near;
	const near = slot(n, "near", showNear ? JSON.stringify(q.near) : "", () =>
		showNear
			? el(
					"div",
					{ className: "near" },
					el("p", {}, el("b", { textContent: t("near") }), " ", q.near.text),
					el(
						"div",
						{ className: "acts" },
						keyBtn("merge:" + q.id + ":" + q.near.id, "merge", "merge"),
						keyBtn("keep:" + q.id, "split", "keep"),
					),
				)
			: null,
	);

	const showAnswer = role !== "host" && !hiddenQ && q.answer;
	const answer = slot(n, "answer", showAnswer ? JSON.stringify(q.answer) : "", () => {
		if (!showAnswer) return null;
		const a = el("div", { className: "answer-pub" }, el("p", { textContent: q.answer.text }));
		if (q.answer.sources.length)
			a.append(el("p", { className: "src-label" }, icon("file"), " ", q.answer.sources.join(", ")));
		return a;
	});

	// 추천 수는 넣지 않는다. 추천이 들어와도 쓰던 답변 칸은 그대로 둔다.
	const showPair = role === "host" && !hiddenQ;
	const pair = slot(
		n,
		"pair",
		showPair ? JSON.stringify([drafts.get(q.id), !!files, q.status, q.text, stale(q.id)]) : "",
		() =>
			showPair
				? draftBlock(
						q,
						ACTIONS[q.status].map(([status, ic, label]) =>
							keyBtn("set:" + q.id + ":" + status, ic, label),
						),
					)
				: null,
	);

	sync(
		li,
		[lead, text, side, similar, near, answer, pair].filter((x) => x),
	);
	return li;
}

function render() {
	const active = document.activeElement;
	const focus = active?.dataset?.key;
	const caret =
		active?.tagName === "TEXTAREA" ? [active.selectionStart, active.selectionEnd] : null;
	const sorted = [...qs.values()].sort(
		(a, b) =>
			// 프로젝터에서는 답변 중인 질문이 맨 위
			(role === "screen" && (b.status === "live") - (a.status === "live")) ||
			(a.status === "done") - (b.status === "done") ||
			b.votes - a.votes ||
			a.id - b.id,
	);
	const shown = sorted.filter((q) => q.status !== "hidden");
	const hidden = sorted.filter((q) => q.status === "hidden");
	for (const id of nodes.keys()) if (!qs.has(id)) nodes.delete(id);
	sync(list, shown.map(item));
	sync($("hidden-qs"), hidden.map(item));
	$("hidden-sum").textContent = t(review ? "hidden.review" : "hidden.h", hidden.length);
	$("hidden").hidden = !hidden.length;
	if (ready) showMessage(shown.length ? null : role === "audience" ? "q.empty.aud" : "q.empty");
	total.textContent = shown.length
		? t("total", shown.length, shown.filter((q) => q.status === "done").length)
		: "";
	if (focus && document.activeElement?.dataset?.key !== focus) {
		const next = document.querySelector('[data-key="' + focus + '"]');
		next?.focus();
		if (next && caret) next.setSelectionRange(...caret);
	}
}

const DRAFT_STATE = {
	ready: ["eyeoff", "st.draft"],
	none: [null, "st.none"],
	error: ["warn", "st.error"],
};

function draftBlock(q, statusBtns) {
	let d = drafts.get(q.id);
	if (stale(q.id)) d = { ...d, status: "error" };
	const box = el("div", { className: "pair" });
	box.dataset.state = d?.approved ? "public" : (d?.status ?? "empty");
	const left = el("div", { className: "answer" });
	const row = el("div", { className: "acts" });
	const state = (ic, k) => el("p", { className: "state" }, ...(ic ? [icon(ic)] : []), t(k));
	const act = (kind, ic, label, primary) => {
		const b = el(
			"button",
			{ type: "button", className: "btn" + (primary ? " primary" : "") },
			icon(ic),
			t(label),
		);
		b.dataset.key = kind + ":" + q.id;
		return b;
	};
	if (d?.approved) {
		left.append(state("eye", "st.public"), el("p", { className: "a", textContent: d.text }));
		row.append(act("unapprove", "eyeoff", "unapprove"));
	} else if (d?.status === "pending") {
		left.append(state("spin", "st.pending"));
	} else {
		left.append(state(...(d ? DRAFT_STATE[d.status] : [null, files ? "st.none" : "st.nofiles"])));
		const ta = el("textarea", {
			rows: 3,
			maxLength: 1000,
			value: edits.get(q.id) ?? d?.text ?? "",
		});
		ta.dataset.key = "edit:" + q.id;
		ta.setAttribute("aria-label", t("answer.label", q.text));
		ta.placeholder = t("answer.ph");
		row.append(act("approve", "eye", "approve", true));
		if (files) row.append(act("draft", "refresh", d ? "redraft" : "mkdraft"));
		left.append(ta);
	}
	row.append(el("span", { className: "gap" }), ...statusBtns);
	left.append(row);
	box.append(left);
	if (d?.status === "none" && !d.approved) {
		const aside = el(
			"aside",
			{ className: "source missing" },
			el("p", { className: "src-label", textContent: t("src.none") }),
		);
		aside.setAttribute("aria-label", t("src.label"));
		box.append(aside);
	} else if (d?.sources.length) {
		const aside = el("aside", { className: "source" });
		aside.setAttribute("aria-label", t("src.label"));
		for (const s of d.sources)
			aside.append(
				el("p", { className: "src-label" }, icon("file"), " ", s.at ? s.key + " · " + s.at : s.key),
				el("blockquote", { textContent: s.text }),
			);
		box.append(aside);
	}
	return box;
}

function send(m) {
	if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
	else setConn("conn.nosend", "bad");
}

function setDraft(id, d) {
	drafts.set(id, d);
	if (d.status !== "pending") return pendAt.delete(id);
	pendAt.set(id, Date.now());
	// 답이 오지 않으면 다시 만들 수 있게 한다.
	setTimeout(render, PENDING_MS + 500);
}

function connect() {
	const q = new URLSearchParams({ v: voter });
	ws = new WebSocket(
		(location.protocol === "https:" ? "wss://" : "ws://") +
			location.host +
			"/api/rooms/" +
			id +
			"/ws?" +
			q,
	);
	ws.onopen = () => {
		retry = 0;
		setConn("conn.ok", "ok");
		if (role === "host") ws.send(JSON.stringify({ t: "auth", k: key }));
		clearInterval(pinger);
		pinger = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 30000);
	};
	ws.onmessage = (e) => {
		if (e.data === "pong") return;
		const m = JSON.parse(e.data);
		if (m.t === "state") {
			// 발표자는 키를 확인받은 뒤의 상태만 쓴다.
			if (role === "host" && !m.host) return;
			review = m.review;
			if (review) $("hidden").open = true;
			paintBar();
			qs.clear();
			mine.clear();
			for (const x of m.qs) qs.set(x.id, x);
			for (const x of m.mine) mine.add(x);
			drafts.clear();
			for (const [k, d] of Object.entries(m.drafts)) setDraft(+k, d);
			setFiles(m.files);
			ready = true;
		} else if (m.t === "q") {
			if (!qs.has(m.q.id) && role !== "audience") live.textContent = t("sr.new", m.q.text);
			qs.set(m.q.id, m.q);
		} else if (m.t === "del") qs.delete(m.id);
		else if (m.t === "draft") {
			setDraft(m.id, m.d);
			if (m.d.status !== "pending") edits.delete(m.id);
		} else if (m.t === "files") setFiles(m.n);
		else if (m.t === "mine") m.mine ? mine.add(m.id) : mine.delete(m.id);
		else if (m.t === "review") {
			review = m.on;
			if (review) $("hidden").open = true;
			paintBar();
		} else if (m.t === "asked") {
			input.value = "";
			err.textContent = m.held ? t("asked.held") : "";
			live.textContent = t("sr.asked");
			return;
		} else if (m.t === "err") {
			if (m.code === "key") return setConn("conn.key", "bad");
			err.textContent = t(
				["length", "slow", "full"].includes(m.code) ? "err." + m.code : "err.ask",
			);
			return;
		}
		render();
	};
	ws.onclose = () => {
		clearInterval(pinger);
		setConn("conn.lost", "bad");
		setTimeout(connect, Math.min(8000, 1000 * 2 ** retry++));
	};
}

const stage = document.querySelector(".list");
// 펼친 묶음은 다시 그려도 펼쳐 둔다.
stage.addEventListener(
	"toggle",
	(e) => {
		const k = e.target.dataset?.key;
		if (k?.startsWith("sim:")) openSim[e.target.open ? "add" : "delete"](+k.slice(4));
	},
	true,
);
function approve(qid) {
	const ta = stage.querySelector('[data-key="edit:' + qid + '"]');
	if (!ta) return;
	const text = ta.value.trim();
	ta.toggleAttribute("aria-invalid", !text);
	if (!text) return ta.focus();
	send({ t: "approve", id: +qid, text });
}

stage.addEventListener("click", (e) => {
	const k = e.target.closest("[data-key]")?.dataset.key;
	if (!k) return;
	const [kind, qid, arg] = k.split(":");
	if (kind === "set") return send({ t: "set", id: +qid, status: arg });
	if (kind === "merge") return send({ t: "merge", id: +qid, into: +arg });
	if (kind === "approve") return approve(qid);
	if (["vote", "split", "keep", "draft", "unapprove"].includes(kind)) send({ t: kind, id: +qid });
});

// 발표자 단축키. 한글 입력 상태에서도 되게 e.code로 본다.
document.addEventListener("keydown", (e) => {
	if (role !== "host" || e.isComposing) return;
	const li = e.target.closest?.("#qs > li");
	if (e.target.tagName === "TEXTAREA") {
		if (e.key === "Escape") li?.focus();
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) approve(e.target.dataset.key.slice(5));
		return;
	}
	if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.("input, select")) return;
	if (e.code === "KeyJ" || e.code === "KeyK") {
		const items = [...list.children];
		const i = items.indexOf(li) + (e.code === "KeyJ" ? 1 : -1);
		const next = items[Math.max(0, Math.min(items.length - 1, i))];
		next?.focus();
		next?.scrollIntoView({ block: "nearest" });
		return;
	}
	const q = li && qs.get(+li.dataset.key.slice(3));
	if (!q) return;
	if (e.code === "KeyL" && q.status !== "done")
		send({ t: "set", id: q.id, status: q.status === "live" ? "open" : "live" });
	else if (e.code === "KeyD" && q.status !== "done") send({ t: "set", id: q.id, status: "done" });
	else if (e.code === "KeyE") {
		e.preventDefault();
		li.querySelector("textarea")?.focus();
	}
});

// 검토 방 전환과 내보내기 (발표자)
function paintBar() {
	const b = $("review");
	b.setAttribute("aria-pressed", review);
	b.replaceChildren(icon(review ? "lock" : "eye"), t("review"));
	$("export").replaceChildren(icon("download"), t("export"));
	$("expires").textContent = expires
		? t("expires", new Date(expires).toLocaleDateString(getLang()))
		: "";
}
$("review").addEventListener("click", () => send({ t: "review", on: !review }));

$("export").addEventListener("click", () => {
	const all = [...qs.values()]
		.filter((q) => q.status !== "hidden")
		.sort((a, b) => b.votes - a.votes || a.id - b.id);
	const kind = (q) => {
		const d = drafts.get(q.id);
		return d?.approved ? "answered" : d?.status === "none" ? "missing" : "rest";
	};
	const out = ["# " + t("title.room", id), ""];
	for (const sec of ["answered", "missing", "rest"]) {
		const rows = all.filter((q) => kind(q) === sec);
		if (!rows.length) continue;
		out.push("## " + t("ex." + sec), "");
		for (const q of rows) {
			out.push("- " + q.text + " (" + t("ex.votes", q.votes) + ")");
			for (const s of q.similar ?? []) out.push("  - " + s.text);
			if (sec === "answered") out.push("", "  " + drafts.get(q.id).text.replace(/\n/g, "\n  "), "");
		}
		out.push("");
	}
	const a = el("a", {
		href: URL.createObjectURL(new Blob([out.join("\n")], { type: "text/markdown" })),
		download: "anyq-" + id + ".md",
	});
	a.click();
	URL.revokeObjectURL(a.href);
});

list.addEventListener("input", (e) => {
	const k = e.target.dataset?.key;
	if (k?.startsWith("edit:")) edits.set(+k.slice(5), e.target.value);
});

// ---- 발표 자료 (발표자)
const FILE_ICON = { queued: "spin", running: "spin", completed: "check", error: "warn" };
const filesUrl = "/api/rooms/" + id + "/files";
let fileTimer,
	fileItems = [],
	fileNote = "mat.empty",
	uploading = null;

function setFiles(n) {
	const changed = n !== files;
	files = n;
	if (role === "host" && changed) refreshFiles();
}

function paintFiles() {
	$("file-list").replaceChildren(
		...fileItems.map((f) =>
			el(
				"li",
				{},
				el("span", {}, icon("file"), " ", f.key),
				el(
					"span",
					{ className: "file-status" },
					...(FILE_ICON[f.status] ? [icon(FILE_ICON[f.status]), " "] : []),
					t("fs." + f.status),
				),
			),
		),
	);
	$("file-note").textContent = fileNote ? t(fileNote) : "";
	$("file-label").replaceChildren(
		icon(uploading ? "spin" : "upload"),
		uploading ? t("mat.uploading", uploading) : t("mat.upload"),
	);
}

async function refreshFiles() {
	clearTimeout(fileTimer);
	if (!files) {
		fileItems = [];
		fileNote = "mat.empty";
		return paintFiles();
	}
	try {
		const res = await fetch(filesUrl, { headers: auth });
		if (!res.ok) throw new Error(res.status);
		fileItems = await res.json();
		const busy =
			fileItems.some((f) => f.status === "queued" || f.status === "running") ||
			fileItems.length < files;
		fileNote = busy ? "mat.busy" : null;
		if (busy) fileTimer = setTimeout(refreshFiles, 3000);
	} catch {
		fileNote = "mat.listfail";
		fileTimer = setTimeout(refreshFiles, 5000);
	}
	paintFiles();
	render();
}

$("file").addEventListener("change", async (e) => {
	const file = e.target.files[0],
		out = $("file-err");
	if (!file) return;
	out.textContent = "";
	if (!/\.(pdf|txt|md)$/i.test(file.name)) return (out.textContent = t("up.415"));
	if (file.size > 10 * 1024 * 1024) return (out.textContent = t("up.413"));
	e.target.disabled = true;
	uploading = file.name;
	paintFiles();
	try {
		const res = await fetch(filesUrl, {
			method: "POST",
			headers: { ...auth, "x-file-name": encodeURIComponent(file.name) },
			body: file,
		});
		if (!res.ok)
			out.textContent = t([403, 413, 415].includes(res.status) ? "up." + res.status : "up.fail");
	} catch {
		out.textContent = t("up.fail");
	}
	e.target.value = "";
	e.target.disabled = false;
	uploading = null;
	paintFiles();
});

form.addEventListener("submit", (e) => {
	e.preventDefault();
	const text = input.value.trim();
	if (text.length < 2) {
		err.textContent = t("err.length");
		input.setAttribute("aria-invalid", "true");
		input.focus();
		return;
	}
	send({ t: "ask", text });
});
input.addEventListener("input", () => {
	err.textContent = "";
	input.removeAttribute("aria-invalid");
});

const copy = $("copy");
let copyState = ["copy", "copy"];
const paintCopy = () => copy.replaceChildren(icon(copyState[0]), t(copyState[1]));
copy.addEventListener("click", async () => {
	try {
		await navigator.clipboard.writeText(audienceUrl);
		copyState = ["check", "copied"];
	} catch {
		copyState = ["warn", "copyfail"];
	}
	paintCopy();
	setTimeout(() => {
		copyState = ["copy", "copy"];
		paintCopy();
	}, 2000);
});

function paintStatic() {
	document.title = t("title.room", id ?? "");
	setConn(...connState);
	showMessage(msgKey);
	paintCopy();
	paintFiles();
	paintBar();
	$("qr").querySelector("svg")?.setAttribute("aria-label", t("qr.label"));
	err.textContent = "";
}
onLang(() => {
	nodes.clear();
	paintStatic();
	render();
});

async function start() {
	paintStatic();
	showMessage("msg.loading");
	let info;
	try {
		const res = await fetch("/api/rooms/" + id, { headers: role === "host" ? auth : {} });
		if (res.status === 404) {
			setConn("conn.404", "bad");
			return showMessage("msg.404");
		}
		if (!res.ok) throw new Error(res.status);
		info = await res.json();
	} catch {
		setConn("conn.fail", "bad");
		return showMessage("msg.fail");
	}
	if (role === "host" && !info.host) {
		setConn("conn.key", "bad");
		return showMessage("msg.key");
	}
	if (role === "audience") form.hidden = false;
	if (role === "host") {
		$("panels").hidden = false;
		$("bar").hidden = false;
		$("keys").hidden = false;
		expires = info.expires;
		paintBar();
		files = info.files;
		refreshFiles();
		Object.assign($("link-aud"), {
			href: audienceUrl,
			textContent: audienceUrl.replace(/^https?:\/\//, ""),
		});
		$("link-screen").href = audienceUrl + "/screen";
	}
	if (role === "screen") {
		const code = qrcode(0, "M");
		code.addData(audienceUrl);
		code.make();
		$("qr").innerHTML = code.createSvgTag({ scalable: true, margin: 0 });
		$("qr").querySelector("svg")?.setAttribute("aria-label", t("qr.label"));
		$("join-url").textContent = audienceUrl.replace(/^https?:\/\//, "");
		$("join").hidden = false;
	}
	connect();
}
start();
