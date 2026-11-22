import qrcode from "qrcode-generator";

const [, , id, view] = location.pathname.split("/");
const role = view === "host" ? "host" : view === "screen" ? "screen" : "audience";
document.body.dataset.role = role;
const key = new URLSearchParams(location.search).get("k");
const audienceUrl = location.origin + "/r/" + id;

const $ = (s) => document.getElementById(s);
const list = $("qs"),
	msg = $("msg"),
	conn = $("conn"),
	live = $("live");
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

const ERRORS = {
	length: "질문은 2자 이상 200자 이하로 적어 주세요.",
	slow: "질문은 5초에 하나씩 올릴 수 있습니다.",
	full: "이 방은 질문이 가득 찼습니다.",
};
const ACTIONS = {
	open: [
		["live", "답변 시작"],
		["done", "답변 완료"],
		["hidden", "숨기기"],
	],
	live: [
		["done", "답변 완료"],
		["open", "답변 취소"],
	],
	done: [
		["open", "다시 열기"],
		["hidden", "숨기기"],
	],
};

function el(tag, props = {}, ...children) {
	const node = Object.assign(document.createElement(tag), props);
	node.append(...children);
	return node;
}

function showMessage(text) {
	msg.textContent = text ?? "";
	msg.hidden = !text;
}

function render() {
	const active = document.activeElement;
	const focus = active?.dataset?.key;
	const caret =
		active?.tagName === "TEXTAREA" ? [active.selectionStart, active.selectionEnd] : null;
	const sorted = [...qs.values()].sort(
		(a, b) => (a.status === "done") - (b.status === "done") || b.votes - a.votes || a.id - b.id,
	);
	list.replaceChildren(
		...sorted.map((q) => {
			const voted = mine.has(q.id);
			const count = [
				el("b", { textContent: q.votes }),
				el("span", { textContent: voted ? "추천함" : "추천" }),
			];
			let lead;
			if (role === "screen" || q.status === "done")
				lead = el("div", { className: "count" }, ...count);
			else {
				lead = el("button", { type: "button", className: "vote" }, ...count);
				lead.dataset.key = "vote:" + q.id;
				lead.setAttribute("aria-pressed", voted);
				lead.setAttribute(
					"aria-label",
					(voted ? "추천 취소" : "추천") + ", 현재 " + q.votes + ": " + q.text,
				);
			}
			const text = el("p", { className: "qtext", textContent: q.text });
			text.style.setProperty("--k", q.status === "done" ? 0 : Math.sqrt(q.votes).toFixed(2));
			if (q.status === "live")
				text.append(el("span", { className: "tag", textContent: "지금 답변 중" }));
			if (q.status === "done")
				text.append(el("span", { className: "tag", textContent: "답변 완료" }));
			const li = el("li", { className: q.status }, lead, text);
			if (q.answer && role !== "host") {
				const a = el("div", { className: "answer-pub" }, el("p", { textContent: q.answer.text }));
				if (q.answer.sources.length)
					a.append(
						el("p", {
							className: "src-label",
							textContent: "근거 · " + q.answer.sources.join(", "),
						}),
					);
				li.append(a);
			}
			if (role === "host") li.append(draftBlock(q));
			if (role === "host") {
				li.append(
					el(
						"div",
						{ className: "acts" },
						...ACTIONS[q.status].map(([status, label]) => {
							const b = el("button", { type: "button", className: "btn", textContent: label });
							b.dataset.key = "set:" + q.id + ":" + status;
							return b;
						}),
					),
				);
			}
			return li;
		}),
	);
	if (ready)
		showMessage(
			qs.size
				? null
				: role === "audience"
					? "아직 질문이 없습니다. 아래 칸에 첫 질문을 적어 보세요."
					: "아직 질문이 없습니다. 청중이 질문을 올리면 여기에 나타납니다.",
		);
	if (focus) {
		const next = list.querySelector('[data-key="' + focus + '"]');
		next?.focus();
		if (next && caret) next.setSelectionRange(...caret);
	}
}

const DRAFT_STATE = {
	pending: "초안을 만드는 중입니다",
	ready: "초안 · 발표자만 봅니다",
	none: "초안 없음 · 직접 답할 수 있습니다",
	error: "초안을 만들지 못했습니다",
};

function draftBlock(q) {
	const d = drafts.get(q.id);
	const box = el("div", { className: "pair" });
	box.dataset.state = d?.approved ? "public" : (d?.status ?? "empty");
	const left = el("div", { className: "answer" });
	const act = (kind, label, primary) => {
		const b = el("button", {
			type: "button",
			className: "btn" + (primary ? " primary" : ""),
			textContent: label,
		});
		b.dataset.key = kind + ":" + q.id;
		return b;
	};
	if (d?.approved) {
		left.append(
			el("p", { className: "state", textContent: "공개됨 · 청중에게 보입니다" }),
			el("p", { className: "a", textContent: d.text }),
			act("unapprove", "공개 취소"),
		);
	} else if (d?.status === "pending") {
		left.append(el("p", { className: "state", textContent: DRAFT_STATE.pending }));
	} else {
		left.append(
			el("p", {
				className: "state",
				textContent: d
					? DRAFT_STATE[d.status]
					: files
						? "초안 없음"
						: "자료를 올리면 초안이 만들어집니다 · 직접 답할 수도 있습니다",
			}),
		);
		const ta = el("textarea", {
			rows: 3,
			maxLength: 1000,
			value: edits.get(q.id) ?? d?.text ?? "",
		});
		ta.dataset.key = "edit:" + q.id;
		ta.setAttribute("aria-label", "답변: " + q.text);
		ta.placeholder = "청중에게 보여 줄 답변";
		const row = el(
			"div",
			{ className: "acts" },
			act("approve", d?.status === "ready" ? "승인하고 공개" : "답변 공개", true),
		);
		if (files) row.append(act("draft", d ? "초안 다시 만들기" : "초안 만들기"));
		left.append(ta, row);
	}
	box.append(left);
	if (d?.status === "none" && !d.approved) {
		box.append(
			el(
				"aside",
				{ className: "source missing" },
				el("p", { className: "src-label", textContent: "자료에 없음" }),
				el("p", {
					textContent: "올린 자료에서 답을 찾지 못했습니다. 지어내지 않고 발표자에게 넘깁니다.",
				}),
			),
		);
	} else if (d?.sources.length) {
		const aside = el("aside", { className: "source" });
		aside.setAttribute("aria-label", "근거 자료");
		for (const s of d.sources)
			aside.append(
				el("p", { className: "src-label", textContent: "근거 · " + s.key }),
				el("blockquote", { textContent: s.text }),
			);
		box.append(aside);
	}
	return box;
}

function send(m) {
	if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
	else setConn("연결이 끊겨 보내지 못했습니다. 다시 연결하는 중입니다.", true);
}

function setConn(text, bad) {
	conn.textContent = text;
	conn.toggleAttribute("data-bad", !!bad);
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
		setConn("방 " + id + " · 연결됨");
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
			if (!qs.has(m.q.id) && role !== "audience") live.textContent = "새 질문: " + m.q.text;
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
			live.textContent = "질문을 올렸습니다.";
			return;
		} else if (m.t === "err") {
			err.textContent = ERRORS[m.code] ?? "질문을 올리지 못했습니다.";
			return;
		}
		render();
	};
	ws.onclose = () => {
		clearInterval(pinger);
		setConn("연결이 끊겼습니다. 다시 연결하는 중입니다.", true);
		setTimeout(connect, Math.min(8000, 1000 * 2 ** retry++));
	};
}

list.addEventListener("click", (e) => {
	const k = e.target.closest("[data-key]")?.dataset.key;
	if (!k) return;
	const [kind, qid, status] = k.split(":");
	if (kind === "edit") return;
	if (kind === "vote") return send({ t: "vote", id: +qid });
	if (kind === "set") return send({ t: "set", id: +qid, status });
	if (kind === "approve") {
		const ta = list.querySelector('[data-key="edit:' + qid + '"]');
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
const FILE_STATUS = {
	queued: "색인 대기 중",
	running: "색인 중",
	completed: "색인 완료",
	error: "색인 실패",
	skipped: "건너뜀",
	outdated: "다시 색인 필요",
};
const UPLOAD_ERRORS = {
	413: "10MiB가 넘는 파일은 올릴 수 없습니다.",
	415: "PDF, TXT, MD 파일만 올릴 수 있습니다.",
	403: "발표자 주소가 맞지 않습니다.",
};
const filesUrl = "/api/rooms/" + id + "/files?k=" + encodeURIComponent(key ?? "");
let fileTimer;

function setFiles(n) {
	const changed = n !== files;
	files = n;
	if (role === "host" && changed) refreshFiles();
}

async function refreshFiles() {
	clearTimeout(fileTimer);
	const ul = $("file-list"),
		note = $("file-note");
	if (!files) {
		ul.replaceChildren();
		note.textContent =
			"아직 올린 자료가 없습니다. 자료를 올리면 질문마다 답변 초안이 만들어집니다.";
		return;
	}
	try {
		const res = await fetch(filesUrl);
		if (!res.ok) throw new Error(res.status);
		const items = await res.json();
		ul.replaceChildren(
			...items.map((f) =>
				el(
					"li",
					{},
					el("span", { textContent: f.key }),
					el("span", { className: "file-status", textContent: FILE_STATUS[f.status] ?? f.status }),
				),
			),
		);
		const busy =
			items.some((f) => f.status === "queued" || f.status === "running") || items.length < files;
		note.textContent = busy ? "색인이 끝나기 전에는 초안이 나오지 않습니다." : "";
		if (busy) fileTimer = setTimeout(refreshFiles, 3000);
	} catch {
		note.textContent = "자료 목록을 불러오지 못했습니다. 잠시 뒤 다시 확인합니다.";
		fileTimer = setTimeout(refreshFiles, 5000);
	}
	render();
}

$("file").addEventListener("change", async (e) => {
	const file = e.target.files[0],
		out = $("file-err"),
		label = $("file-label");
	if (!file) return;
	out.textContent = "";
	if (!/\.(pdf|txt|md)$/i.test(file.name)) return (out.textContent = UPLOAD_ERRORS[415]);
	if (file.size > 10 * 1024 * 1024) return (out.textContent = UPLOAD_ERRORS[413]);
	e.target.disabled = true;
	label.textContent = file.name + " 올리는 중입니다";
	try {
		const res = await fetch(filesUrl, {
			method: "POST",
			headers: { "x-file-name": encodeURIComponent(file.name) },
			body: file,
		});
		if (!res.ok)
			out.textContent =
				UPLOAD_ERRORS[res.status] ?? "자료를 올리지 못했습니다. 잠시 뒤 다시 올려 주세요.";
	} catch {
		out.textContent = "자료를 올리지 못했습니다. 네트워크를 확인해 주세요.";
	}
	e.target.value = "";
	e.target.disabled = false;
	label.textContent = "발표 자료 올리기";
});

form.addEventListener("submit", (e) => {
	e.preventDefault();
	const text = input.value.trim();
	if (text.length < 2) {
		err.textContent = ERRORS.length;
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

async function start() {
	showMessage("질문을 불러오는 중입니다.");
	let info;
	try {
		const res = await fetch(
			"/api/rooms/" + id + (role === "host" && key ? "?k=" + encodeURIComponent(key) : ""),
		);
		if (res.status === 404) {
			setConn("없는 방입니다.", true);
			return showMessage(
				"이 주소의 방을 찾지 못했습니다. 주소를 다시 확인하거나 발표자에게 QR을 다시 받아 주세요.",
			);
		}
		if (!res.ok) throw new Error(res.status);
		info = await res.json();
	} catch {
		setConn("방 정보를 불러오지 못했습니다.", true);
		return showMessage("방 정보를 불러오지 못했습니다. 네트워크를 확인하고 새로 고쳐 주세요.");
	}
	if (role === "host" && !info.host) {
		setConn("발표자 링크가 맞지 않습니다.", true);
		return showMessage("발표자 주소가 맞지 않습니다. 방을 만들 때 받은 주소로 다시 들어와 주세요.");
	}
	document.title = "anyq 질문 방 " + id;
	if (role === "audience") form.hidden = false;
	if (role === "host") {
		$("share").hidden = false;
		$("materials").hidden = false;
		files = info.files;
		refreshFiles();
		Object.assign($("link-aud"), { href: audienceUrl, textContent: audienceUrl });
		$("link-screen").href = audienceUrl + "/screen";
		$("copy").addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(audienceUrl);
				$("copy").textContent = "복사했습니다";
			} catch {
				$("copy").textContent = "복사하지 못했습니다";
			}
		});
	}
	if (role === "screen") {
		const code = qrcode(0, "M");
		code.addData(audienceUrl);
		code.make();
		$("qr").innerHTML = code.createSvgTag({ scalable: true, margin: 0 });
		$("qr").querySelector("svg")?.setAttribute("aria-label", "청중 참여 QR 코드");
		$("join-url").textContent = audienceUrl.replace(/^https?:\/\//, "");
		$("join").hidden = false;
	}
	connect();
}
start();
