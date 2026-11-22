// 테마, 언어, 아이콘. 두 화면이 함께 쓴다.
const store = {
	get: (k) => {
		try {
			return localStorage.getItem(k);
		} catch {
			return null;
		}
	},
	set: (k, v) => {
		try {
			localStorage.setItem(k, v);
		} catch {}
	},
};

// 24px 격자, 각진 끝. 화면의 형태(모서리 0)와 맞춘다.
const ICONS = {
	up: '<path d="M5 15l7-7 7 7"/>',
	copy: '<path d="M9 9h11v11H9zM5 15V4h11"/>',
	ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
	upload: '<path d="M12 16V4M6 10l6-6 6 6M4 20h16"/>',
	file: '<path d="M6 3h8l4 4v14H6zM14 3v4h4"/>',
	check: '<path d="M4 12l5 5L20 6"/>',
	warn: '<path d="M12 4l9 16H3zM12 10v5M12 17.5v.5"/>',
	sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
	moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
	globe:
		'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
	play: '<path d="M7 4l13 8-13 8z"/>',
	eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/>',
	eyeoff: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6zM4 4l16 16"/>',
	undo: '<path d="M8 6l-5 5 5 5M3 11h12a5 5 0 0 1 0 10h-3"/>',
	refresh: '<path d="M20 5v6h-6M4 19v-6h6M19.5 11A7.5 7.5 0 0 0 6 8M4.5 13A7.5 7.5 0 0 0 18 16"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	lock: '<path d="M6 11h12v9H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11"/>',
	screen: '<path d="M3 5h18v12H3zM8 21h8M12 17v4"/>',
	spin: '<path d="M12 3a9 9 0 1 0 9 9"/>',
	merge: '<path d="M6 4v5l6 5v6M18 4v5l-6 5"/>',
	split: '<path d="M12 4v6l-6 5v5M12 10l6 5v5"/>',
};

export function icon(name) {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("class", name === "spin" ? "ico spin" : "ico");
	svg.setAttribute("aria-hidden", "true");
	svg.innerHTML = ICONS[name];
	return svg;
}

const M = {
	ko: {
		"title.home": "anyq: 발표 자료에서 답을 찾아 두는 Q&A",
		"title.room": "anyq 질문 방 {0}",
		"logo.label": "anyq 처음으로",
		"nav.wall": "예시",
		"nav.draft": "초안",
		"nav.flow": "순서",
		"nav.stack": "구성",
		toLight: "밝은 화면으로",
		toDark: "어두운 화면으로",
		"lang.name": "EN",
		"lang.label": "Switch to English",
		h1: "질문이 오면\n발표 자료에서\n답을 찾아 둡니다.",
		"hero.p": "청중은 QR로 묻고 추천합니다. 초안과 근거는 발표자만 보고, 승인한 답만 공개됩니다.",
		create: "방 만들기",
		creating: "만드는 중",
		verifying: "확인 중",
		"hero.demo": "예시 보기",
		"hero.note": "계정 필요 없음",
		"err.turnstile": "사람 확인 실패. 다시 눌러 주세요.",
		"err.create": "방을 만들지 못했습니다. 다시 눌러 주세요.",
		"err.net": "네트워크를 확인하고 다시 눌러 주세요.",
		"wall.h": "추천이 많을수록 크게",
		"wall.p": "프로젝터 화면 예시. 추천을 눌러 보세요.",
		"q.empty.aud": "첫 질문을 올려 보세요.",
		"q.empty": "아직 질문이 없습니다.",
		"ask.label": "질문",
		"ask.ph": "발표자에게 묻고 싶은 것",
		"ask.submit": "올리기",
		"ask.err.empty": "질문을 적어 주세요.",
		vote: "추천",
		unvote: "추천 취소",
		"vote.label": "{0}, 현재 {1}: {2}",
		"live.tag": "답변 중",
		"done.tag": "답변 완료",
		"sr.voted": "{0} 추천 {1}",
		"sr.asked": "질문을 올렸습니다.",
		"sr.new": "새 질문: {0}",
		"seed.0": "Slido랑 뭐가 다른가요?",
		"seed.1": "PDF는 몇 MB까지 올릴 수 있나요?",
		"seed.2": "AI가 틀린 답을 하면 어떻게 되나요?",
		"seed.3": "Google Docs도 연결되나요?",
		"seed.4": "무료 플랜으로 몇 명까지 접속할 수 있나요?",
		"seed.5": "로그인해야 하나요?",
		"draft.h": "초안 옆에 근거",
		"draft.p": "발표자 화면 예시. 자료는 이 프로젝트의 기획 문서(handoff.md).",
		"demo.a1": "OCR을 쓰면 10MiB, 쓰지 않으면 4MiB까지 올릴 수 있습니다.",
		"demo.src1": "handoff.md, 3. 설계 초안",
		"demo.quote1": "파일 크기 한도: PDF는 OCR 사용 시 10MiB, 미사용 시 4MiB. 일반 텍스트류 10MiB.",
		"st.draft": "초안 · 비공개",
		"st.public": "공개됨",
		"st.pending": "초안 작성 중",
		"st.none": "초안 없음",
		"st.error": "초안 실패",
		"st.nofiles": "자료를 올리면 초안이 생깁니다",
		approve: "공개",
		unapprove: "공개 취소",
		redraft: "초안 다시",
		mkdraft: "초안 만들기",
		src: "근거",
		"src.label": "근거 자료",
		"src.none": "자료에 없음",
		"answer.ph": "청중에게 보여 줄 답변",
		"answer.label": "답변: {0}",
		"flow.h": "진행 순서",
		"who.p": "발표자",
		"who.c": "청중",
		"flow.1": "방을 만들고 QR을 띄웁니다.",
		"flow.2": "발표 자료를 올립니다.",
		"flow.3": "자료를 색인합니다.",
		"flow.4": "QR로 들어와 묻고 추천합니다. 계정 없이.",
		"flow.5": "질문마다 초안과 근거를 찾습니다. 자료에 없으면 근거 칸이 빕니다.",
		"flow.6": "초안을 승인하거나 고쳐서 공개합니다.",
		"stack.h": "내 Cloudflare 계정에 배포",
		"stack.p": "오픈소스 공개 예정",
		"stack.workers": "요청 처리, 화면 제공",
		"stack.do": "방 상태와 기록(SQLite), 실시간 전달(WebSocket)",
		"stack.search": "방마다 인스턴스 하나. 자료 보관, 색인, 검색",
		"stack.ai": "검색된 자료로 초안 작성",
		"stack.ts": "방 만들기 전 사람 확인",
		footer: "Cloudflare Developer Day Seoul 2026 Use Case 공모전 출품 준비 중 · MIT",
		"room.h": "질문 방",
		"conn.ing": "연결 중",
		"conn.ok": "연결됨",
		"conn.lost": "재연결 중",
		"conn.nosend": "보내지 못함. 재연결 중",
		"conn.404": "없는 방",
		"conn.fail": "불러오지 못함",
		"conn.key": "발표자 링크 오류",
		"msg.loading": "불러오는 중",
		"msg.404": "방을 찾지 못했습니다. 주소를 확인하거나 QR을 다시 찍어 주세요.",
		"msg.fail": "방을 불러오지 못했습니다. 새로 고쳐 주세요.",
		"msg.key": "발표자 주소가 맞지 않습니다. 방을 만들 때 받은 주소로 들어와 주세요.",
		"share.h": "공유",
		copy: "복사",
		copied: "복사됨",
		copyfail: "복사 실패",
		"share.screen": "프로젝터 화면",
		"share.note": "이 페이지 주소는 공유하지 마세요. 발표자 권한이 들어 있습니다.",
		"mat.h": "자료",
		"mat.upload": "올리기",
		"mat.uploading": "{0} 올리는 중",
		"mat.hint": "PDF · TXT · MD, 10MiB까지",
		"mat.empty": "자료를 올리면 질문마다 초안이 생깁니다.",
		"mat.busy": "색인이 끝나면 초안이 나옵니다.",
		"mat.listfail": "목록을 불러오지 못했습니다. 곧 다시 시도합니다.",
		"fs.queued": "대기",
		"fs.running": "색인 중",
		"fs.completed": "색인 완료",
		"fs.error": "색인 실패",
		"fs.skipped": "건너뜀",
		"fs.outdated": "재색인 필요",
		"up.413": "10MiB가 넘습니다.",
		"up.415": "PDF, TXT, MD만 됩니다.",
		"up.403": "발표자 링크 오류",
		"up.fail": "올리지 못했습니다. 다시 시도해 주세요.",
		"err.length": "2자 이상 200자 이하로 적어 주세요.",
		"err.slow": "5초에 하나씩 올릴 수 있습니다.",
		"err.full": "질문이 가득 찼습니다.",
		"err.ask": "올리지 못했습니다.",
		"act.live": "답변 시작",
		"act.done": "완료",
		"act.hide": "숨기기",
		"act.cancel": "취소",
		"act.reopen": "다시 열기",
		join: "QR로 질문하기",
		"qr.label": "청중 참여 QR 코드",
		total: "질문 {0} · 완료 {1}",
		similar: "비슷한 질문 {0}",
		split: "분리",
		near: "비슷함",
		merge: "합치기",
		keep: "따로 두기",
		"hidden.h": "숨김 {0}",
		"act.unhide": "되돌리기",
	},
	en: {
		"title.home": "anyq: live Q&A with answers drafted from your slides",
		"title.room": "anyq room {0}",
		"logo.label": "anyq home",
		"nav.wall": "Demo",
		"nav.draft": "Drafts",
		"nav.flow": "Flow",
		"nav.stack": "Stack",
		toLight: "Switch to light",
		toDark: "Switch to dark",
		"lang.name": "한국어",
		"lang.label": "한국어로 바꾸기",
		h1: "Audience asks.\nYour slides\ndraft a reply.",
		"hero.p":
			"The audience asks and upvotes by QR. Drafts and sources stay with you, and only approved answers go public.",
		create: "Create a room",
		creating: "Creating",
		verifying: "Verifying",
		"hero.demo": "Try the demo",
		"hero.note": "No account needed",
		"err.turnstile": "Verification failed. Try again.",
		"err.create": "Couldn't create the room. Try again.",
		"err.net": "Check your connection and try again.",
		"wall.h": "More votes, bigger type",
		"wall.p": "A sample projector view. Try voting.",
		"q.empty.aud": "Be the first to ask.",
		"q.empty": "No questions yet.",
		"ask.label": "Question",
		"ask.ph": "What do you want to ask?",
		"ask.submit": "Ask",
		"ask.err.empty": "Type a question first.",
		vote: "Upvote",
		unvote: "Remove vote",
		"vote.label": "{0}, now {1}: {2}",
		"live.tag": "Answering now",
		"done.tag": "Answered",
		"sr.voted": "{0}: {1} votes",
		"sr.asked": "Question posted.",
		"sr.new": "New question: {0}",
		"seed.0": "How is this different from Slido?",
		"seed.1": "How large can a PDF be?",
		"seed.2": "What if the AI drafts a wrong answer?",
		"seed.3": "Does it connect to Google Docs?",
		"seed.4": "How many people can join on the free plan?",
		"seed.5": "Do I need to log in?",
		"draft.h": "Draft next to its source",
		"draft.p": "A sample host view. The material is this project's planning doc (handoff.md).",
		"demo.a1": "Up to 10 MiB with OCR, 4 MiB without.",
		"demo.src1": "handoff.md, 3. Design draft",
		"demo.quote1": "File size limits: PDF 10 MiB with OCR, 4 MiB without. Plain text 10 MiB.",
		"st.draft": "Draft · private",
		"st.public": "Public",
		"st.pending": "Drafting",
		"st.none": "No draft",
		"st.error": "Draft failed",
		"st.nofiles": "Upload material to get drafts",
		approve: "Publish",
		unapprove: "Unpublish",
		redraft: "Redraft",
		mkdraft: "Draft",
		src: "Source",
		"src.label": "Sources",
		"src.none": "Not in the material",
		"answer.ph": "Answer shown to the audience",
		"answer.label": "Answer: {0}",
		"flow.h": "How a talk goes",
		"who.p": "Host",
		"who.c": "Audience",
		"flow.1": "Creates a room and shows the QR.",
		"flow.2": "Uploads the talk material.",
		"flow.3": "Indexes the material.",
		"flow.4": "Joins by QR, asks and upvotes. No account.",
		"flow.5":
			"Finds a draft and its source for each question. If the material has no answer, the source box stays empty.",
		"flow.6": "Approves or edits the draft, then publishes.",
		"stack.h": "Deploys to your own Cloudflare account",
		"stack.p": "Open source release planned",
		"stack.workers": "Requests and pages",
		"stack.do": "Room state and history (SQLite), realtime (WebSocket)",
		"stack.search": "One instance per room: storage, indexing, search",
		"stack.ai": "Drafts from retrieved passages",
		"stack.ts": "Human check before creating a room",
		footer: "Preparing an entry for the Cloudflare Developer Day Seoul 2026 Use Case contest · MIT",
		"room.h": "Question room",
		"conn.ing": "Connecting",
		"conn.ok": "Connected",
		"conn.lost": "Reconnecting",
		"conn.nosend": "Not sent. Reconnecting",
		"conn.404": "Room not found",
		"conn.fail": "Failed to load",
		"conn.key": "Invalid host link",
		"msg.loading": "Loading",
		"msg.404": "Room not found. Check the address or scan the QR again.",
		"msg.fail": "Couldn't load the room. Refresh to retry.",
		"msg.key": "This host link is invalid. Use the address you got when creating the room.",
		"share.h": "Share",
		copy: "Copy",
		copied: "Copied",
		copyfail: "Copy failed",
		"share.screen": "Projector view",
		"share.note": "Don't share this page's address. It carries host access.",
		"mat.h": "Material",
		"mat.upload": "Upload",
		"mat.uploading": "Uploading {0}",
		"mat.hint": "PDF · TXT · MD, up to 10 MiB",
		"mat.empty": "Upload material to get a draft for each question.",
		"mat.busy": "Drafts start once indexing finishes.",
		"mat.listfail": "Couldn't load the list. Retrying soon.",
		"fs.queued": "Queued",
		"fs.running": "Indexing",
		"fs.completed": "Indexed",
		"fs.error": "Failed",
		"fs.skipped": "Skipped",
		"fs.outdated": "Needs reindex",
		"up.413": "Over 10 MiB.",
		"up.415": "PDF, TXT or MD only.",
		"up.403": "Invalid host link",
		"up.fail": "Upload failed. Try again.",
		"err.length": "Use 2 to 200 characters.",
		"err.slow": "One question every 5 seconds.",
		"err.full": "This room is full.",
		"err.ask": "Couldn't post.",
		"act.live": "Start answering",
		"act.done": "Done",
		"act.hide": "Hide",
		"act.cancel": "Cancel",
		"act.reopen": "Reopen",
		join: "Scan to ask",
		"qr.label": "QR code to join",
		total: "{0} questions · {1} answered",
		similar: "{0} similar",
		split: "Split",
		near: "Similar to",
		merge: "Merge",
		keep: "Keep separate",
		"hidden.h": "Hidden {0}",
		"act.unhide": "Restore",
	},
};

let lang = store.get("anyq-lang");
if (!M[lang]) lang = (navigator.language ?? "ko").startsWith("ko") ? "ko" : "en";
let theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
const listeners = [];

export const getLang = () => lang;
export const getTheme = () => theme;
export const onLang = (fn) => listeners.push(fn);
export function t(key, ...args) {
	let s = M[lang][key] ?? M.ko[key] ?? key;
	args.forEach((v, i) => (s = s.replace("{" + i + "}", v)));
	return s;
}

const langBtn = document.getElementById("lang"),
	themeBtn = document.getElementById("theme");

function paint() {
	document.documentElement.lang = lang;
	for (const n of document.querySelectorAll("[data-i18n]")) n.textContent = t(n.dataset.i18n);
	for (const n of document.querySelectorAll("[data-i18n-ph]")) n.placeholder = t(n.dataset.i18nPh);
	for (const n of document.querySelectorAll("[data-i18n-label]"))
		n.setAttribute("aria-label", t(n.dataset.i18nLabel));
	if (langBtn) {
		const name = document.createElement("span");
		name.textContent = t("lang.name");
		name.lang = lang === "ko" ? "en" : "ko";
		langBtn.replaceChildren(icon("globe"), name);
		langBtn.setAttribute("aria-label", t("lang.label"));
		langBtn.hidden = false;
	}
	if (themeBtn) {
		themeBtn.replaceChildren(icon(theme === "dark" ? "sun" : "moon"));
		themeBtn.setAttribute("aria-label", t(theme === "dark" ? "toLight" : "toDark"));
		themeBtn.hidden = false;
	}
}

langBtn?.addEventListener("click", () => {
	lang = lang === "ko" ? "en" : "ko";
	store.set("anyq-lang", lang);
	paint();
	for (const fn of listeners) fn();
});
themeBtn?.addEventListener("click", () => {
	theme = theme === "dark" ? "light" : "dark";
	document.documentElement.dataset.theme = theme;
	store.set("anyq-theme", theme);
	paint();
});

for (const n of document.querySelectorAll("[data-icon]")) n.replaceWith(icon(n.dataset.icon));
paint();
