import qrcode from "qrcode-generator";
import { icon, onLang, t } from "./ui.js";

const [, , id, view] = location.pathname.split("/");
const role = view === "host" ? "host" : view === "screen" ? "screen" : "audience";
document.body.dataset.role = role;
const key = new URLSearchParams(location.search).get("k");
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
let files = 0;
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

function item(q) {
	const hiddenQ = q.status === "hidden";
	const voted = mine.has(q.id);
	const count = [icon("up"), el("b", { textContent: q.votes })];
	let lead;
	if (role === "screen" || q.status === "done" || hiddenQ)
		lead = el("div", { className: "count" }, ...count);
	else {
		lead = el("button", { type: "button", className: "vote" }, ...count);
		lead.dataset.key = "vote:" + q.id;
		lead.setAttribute("aria-pressed", voted);
		lead.setAttribute("aria-label", t("vote.label", t(voted ? "unvote" : "vote"), q.votes, q.text));
	}
	const text = el("p", { className: "qtext", textContent: q.text });
	text.style.setProperty("--k", q.status === "done" || hiddenQ ? 0 : Math.sqrt(q.votes).toFixed(2));
	if (q.status === "live") text.append(el("span", { className: "tag" }, t("live.tag")));
	if (q.status === "done")
		text.append(el("span", { className: "tag" }, icon("check"), " ", t("done.tag")));
	const li = el("li", { className: q.status }, lead, text);
	if (hiddenQ) {
		li.append(
			el("div", { className: "acts side" }, keyBtn("set:" + q.id + ":open", "undo", "act.unhide")),
		);
		return li;
	}
	if (q.similar?.length) {
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
		li.append(box);
	}
	if (q.near && role === "host")
		li.append(
			el(
				"div",
				{ className: "near" },
				el("p", {}, el("b", { textContent: t("near") }), " ", q.near.text),
				el(
					"div",
					{ className: "acts" },
					keyBtn("merge:" + q.id + ":" + q.near.id, "merge", "merge"),
					keyBtn("keep:" + q.id, "split", "keep"),
				),
			),
		);
	if (q.answer && role !== "host") {
		const a = el("div", { className: "answer-pub" }, el("p", { textContent: q.answer.text }));
		if (q.answer.sources.length)
			a.append(el("p", { className: "src-label" }, icon("file"), " ", q.answer.sources.join(", ")));
		li.append(a);
	}
	if (role === "host")
		li.append(
			draftBlock(
				q,
				ACTIONS[q.status].map(([status, ic, label]) =>
					keyBtn("set:" + q.id + ":" + status, ic, label),
				),
			),
		);
	return li;
}

const openSim = new Set();
function render() {
	const active = document.activeElement;
	const focus = active?.dataset?.key;
	const caret =
		active?.tagName === "TEXTAREA" ? [active.selectionStart, active.selectionEnd] : null;
	const sorted = [...qs.values()].sort(
		(a, b) => (a.status === "done") - (b.status === "done") || b.votes - a.votes || a.id - b.id,
	);
	const shown = sorted.filter((q) => q.status !== "hidden");
	const hidden = sorted.filter((q) => q.status === "hidden");
	list.replaceChildren(...shown.map(item));
	$("hidden-qs").replaceChildren(...hidden.map(item));
	$("hidden-sum").textContent = t("hidden.h", hidden.length);
	$("hidden").hidden = !hidden.length;
	if (ready) showMessage(shown.length ? null : role === "audience" ? "q.empty.aud" : "q.empty");
	total.hidden = role !== "host" || !shown.length;
	total.textContent = t("total", shown.length, shown.filter((q) => q.status === "done").length);
	if (focus) {
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
	const d = drafts.get(q.id);
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
				el("p", { className: "src-label" }, icon("file"), " ", s.key),
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

function connect() {
	const q = new URLSearchParams({ v: voter });
	if (role === "host" && key) q.set("k", key);
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
		clearInterval(pinger);
		pinger = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 30000);
	};
	ws.onmessage = (e) => {
		if (e.data === "pong") return;
		const m = JSON.parse(e.data);
		if (m.t === "state") {
			qs.clear();
			mine.clear();
			for (const x of m.qs) qs.set(x.id, x);
			for (const x of m.mine) mine.add(x);
			drafts.clear();
			for (const [k, d] of Object.entries(m.drafts)) drafts.set(+k, d);
			setFiles(m.files);
			ready = true;
		} else if (m.t === "q") {
			if (!qs.has(m.q.id) && role !== "audience") live.textContent = t("sr.new", m.q.text);
			qs.set(m.q.id, m.q);
		} else if (m.t === "del") qs.delete(m.id);
		else if (m.t === "draft") {
			drafts.set(m.id, m.d);
			if (m.d.status !== "pending") edits.delete(m.id);
		} else if (m.t === "files") setFiles(m.n);
		else if (m.t === "mine") m.mine ? mine.add(m.id) : mine.delete(m.id);
		else if (m.t === "asked") {
			input.value = "";
			err.textContent = "";
			live.textContent = t("sr.asked");
			return;
		} else if (m.t === "err") {
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
stage.addEventListener("click", (e) => {
	const k = e.target.closest("[data-key]")?.dataset.key;
	if (!k) return;
	const [kind, qid, status] = k.split(":");
	if (kind === "edit") return;
	if (kind === "vote") return send({ t: "vote", id: +qid });
	if (kind === "sim") return;
	if (kind === "set") return send({ t: "set", id: +qid, status });
	if (kind === "merge") return send({ t: "merge", id: +qid, into: +status });
	if (kind === "approve") {
		const ta = stage.querySelector('[data-key="edit:' + qid + '"]');
		const text = ta.value.trim();
		ta.toggleAttribute("aria-invalid", !text);
		if (!text) return ta.focus();
		return send({ t: "approve", id: +qid, text });
	}
	send({ t: kind, id: +qid });
});

list.addEventListener("input", (e) => {
	const k = e.target.dataset?.key;
	if (k?.startsWith("edit:")) edits.set(+k.slice(5), e.target.value);
});

// ---- 발표 자료 (발표자)
const FILE_ICON = { queued: "spin", running: "spin", completed: "check", error: "warn" };
const filesUrl = "/api/rooms/" + id + "/files?k=" + encodeURIComponent(key ?? "");
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
		const res = await fetch(filesUrl);
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
			headers: { "x-file-name": encodeURIComponent(file.name) },
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
	$("qr").querySelector("svg")?.setAttribute("aria-label", t("qr.label"));
	err.textContent = "";
}
onLang(() => {
	paintStatic();
	render();
});

async function start() {
	paintStatic();
	showMessage("msg.loading");
	let info;
	try {
		const res = await fetch(
			"/api/rooms/" + id + (role === "host" && key ? "?k=" + encodeURIComponent(key) : ""),
		);
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
