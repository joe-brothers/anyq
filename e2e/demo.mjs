// 데모 녹화: HOST_URL='https://anyq.joe-brothers.com/r/<코드>/host#k=<키>' node demo.mjs
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const host = process.env.HOST_URL;
if (!host) throw new Error("HOST_URL 필요");
const room = host.replace(/\/host.*$/, "");
const out = "demo-out";
mkdirSync(out, { recursive: true });
const H = 720;
const browser = await chromium.launch({ channel: "chrome", headless: false });
const open = async (url, width, record = true) => {
	const ctx = await browser.newContext({
		locale: "ko-KR",
		viewport: { width, height: H },
		...(record ? { recordVideo: { dir: out, size: { width, height: H } } } : {}),
	});
	const page = await ctx.newPage();
	await page.goto(url);
	return page;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = async (p, text, name) => {
	if (name)
		await p
			.getByLabel("이름")
			.fill(name)
			.catch(() => {});
	await p.locator("#q").pressSequentially(text, { delay: 45 });
	await p.getByRole("button", { name: "올리기" }).click();
};
const step = async (name, fn) => {
	try {
		await fn();
	} catch (e) {
		console.log("건너뜀:", name, String(e).split("\n")[0]);
	}
};

const hostP = await open(host, 960);
const phone = await open(room, 390);
const screen = await open(room + "/screen", 960);
const voters = await Promise.all([1, 2, 3].map(() => open(room, 390, false)));
await wait(2500);

await ask(phone, "방 하나에 질문 몇 개까지 받아요?", "철수");
await wait(15000); // 초안 대기
await step("공개", async () => {
	const q = hostP.locator("#qs > li", { hasText: "질문 몇 개까지" });
	const ta = q.locator("textarea");
	if (!(await ta.inputValue()))
		await ta.pressSequentially("방 하나에 300개까지 받습니다.", { delay: 45 });
	else await ta.pressSequentially(" 감사합니다!", { delay: 45 });
	await wait(1000);
	await q.getByRole("button", { name: "공개", exact: true }).click();
});
await wait(4000);

await ask(phone, "모바일 앱도 나오나요?");
await wait(12000); // "자료에 없음"

await ask(phone, "비용 얼마나 들어요?");
await wait(2500);
await ask(voters[0], "요금은 어떻게 되나요?", "영희");
await wait(8000); // 비슷한 질문 합치기
await step("추천", async () => {
	for (const v of voters) {
		await v
			.locator("#qs > li", { hasText: /비용|요금/ })
			.first()
			.getByRole("button", { name: /추천/ })
			.click();
		await wait(900);
	}
});
await wait(6000);

const paths = await Promise.all([hostP, phone, screen].map((p) => p.video().path()));
await browser.close();
execFileSync(
	"ffmpeg",
	[
		"-y",
		...paths.flatMap((p) => ["-i", p]),
		"-filter_complex",
		"[0:v][1:v][2:v]hstack=inputs=3,scale=1920:-2",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		out + "/demo.mp4",
	],
	{ stdio: "inherit" },
);
console.log("완료:", out + "/demo.mp4");
