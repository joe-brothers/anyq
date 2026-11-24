import { ApiError, api } from "./api.ts";
import { getLang, getTheme, icon, onLang, t } from "./ui.ts";

declare global {
	interface Window {
		turnstile?: { render(el: HTMLElement, opts: Record<string, unknown>): void };
	}
}

type DemoQ = {
	id: number;
	seed?: number;
	text?: string;
	votes: number;
	live: boolean;
	mine: boolean;
};

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.getElementById(s) as T;

// 예시 방: 이 페이지 안에서만 움직인다.
const qs: DemoQ[] = [14, 9, 6, 4, 2, 1].map((votes, id) => ({
	id,
	seed: id,
	votes,
	live: id === 1,
	mine: false,
}));
const list = $("qs"),
	empty = $("qs-empty"),
	live = $("live");
const textOf = (q: DemoQ) => q.text ?? t("seed." + q.seed);

function render(focusId?: number) {
	qs.sort((a, b) => b.votes - a.votes || a.id - b.id);
	list.replaceChildren(
		...qs.map((q) => {
			const li = document.createElement("li");
			if (q.live) li.className = "live";
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "vote";
			btn.dataset.id = String(q.id);
			btn.setAttribute("aria-pressed", String(q.mine));
			btn.setAttribute(
				"aria-label",
				t("vote.label", t(q.mine ? "unvote" : "vote"), q.votes, textOf(q)),
			);
			const n = document.createElement("b");
			n.textContent = String(q.votes);
			btn.append(icon("up"), n);
			const p = document.createElement("p");
			p.className = "qtext";
			p.style.setProperty("--k", Math.sqrt(q.votes).toFixed(2));
			p.textContent = textOf(q);
			if (q.live) {
				const tag = document.createElement("span");
				tag.className = "tag";
				tag.textContent = t("live.tag");
				p.append(tag);
			}
			li.append(btn, p);
			return li;
		}),
	);
	empty.hidden = qs.length > 0;
	if (focusId != null) list.querySelector<HTMLElement>('[data-id="' + focusId + '"]')?.focus();
}

list.addEventListener("click", (e) => {
	const btn = (e.target as HTMLElement).closest<HTMLElement>(".vote");
	const q = btn && qs.find((q) => q.id === Number(btn.dataset.id));
	if (!q) return;
	q.mine = !q.mine;
	q.votes += q.mine ? 1 : -1;
	render(q.id);
	live.textContent = t("sr.voted", textOf(q), q.votes);
});

const form = $("ask"),
	input = $<HTMLInputElement>("q"),
	err = $("q-err");
let nextId = qs.length;
form.addEventListener("submit", (e) => {
	e.preventDefault();
	const text = input.value.trim();
	if (!text) {
		err.textContent = t("ask.err.empty");
		input.setAttribute("aria-invalid", "true");
		input.focus();
		return;
	}
	qs.push({ id: nextId++, text, votes: 0, live: false, mine: false });
	input.value = "";
	err.textContent = "";
	input.removeAttribute("aria-invalid");
	render();
	live.textContent = t("sr.asked");
});
input.addEventListener("input", () => {
	err.textContent = "";
	input.removeAttribute("aria-invalid");
});

// 예시 초안: 승인하면 밝아진다.
const pair = $("pair-1"),
	approve = $("approve"),
	state = $("state-1");
function paintPair() {
	const pub = pair.dataset.state === "public";
	state.replaceChildren(icon(pub ? "eye" : "eyeoff"), t(pub ? "st.public" : "st.draft"));
	approve.replaceChildren(icon(pub ? "eyeoff" : "eye"), t(pub ? "unapprove" : "approve"));
}
approve.addEventListener("click", () => {
	pair.dataset.state = pair.dataset.state === "public" ? "draft" : "public";
	paintPair();
});

// 방 만들기
const create = $<HTMLButtonElement>("create"),
	createErr = $("create-err"),
	ts = $("ts");
let busy: string | null = null,
	errKey: string | null = null;
function paintCreate() {
	create.disabled = !!busy;
	create.replaceChildren(icon(busy ? "spin" : "plus"), t(busy ?? "create"));
	createErr.textContent = errKey ? t(errKey) : "";
}
const idle = (key: string | null = null) => {
	busy = null;
	errKey = key;
	paintCreate();
};

async function createRoom(token?: string) {
	busy = "creating";
	paintCreate();
	try {
		const room = await api.createRoom(token);
		location.href = "/r/" + room.id + "/host#k=" + room.token;
	} catch (e) {
		idle(e instanceof ApiError && e.status === 403 ? "err.turnstile" : "err.create");
	}
}

// Turnstile 스크립트는 버튼을 누른 뒤에만 불러온다.
const loadTurnstile = () =>
	new Promise<void>((ok, fail) => {
		if (window.turnstile) return ok();
		const s = document.createElement("script");
		s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
		s.onload = () => ok();
		s.onerror = fail;
		document.head.append(s);
	});

create.addEventListener("click", async () => {
	busy = "verifying";
	errKey = null;
	paintCreate();
	try {
		const { sitekey } = await api.config();
		if (!sitekey) return createRoom();
		await loadTurnstile();
		ts.replaceChildren();
		window.turnstile!.render(ts, {
			sitekey,
			theme: getTheme(),
			language: getLang(),
			appearance: "interaction-only",
			callback: createRoom,
			"error-callback": () => idle("err.turnstile"),
		});
	} catch {
		idle("err.net");
	}
});

const paint = () => {
	render();
	paintPair();
	paintCreate();
};
onLang(paint);
paint();
