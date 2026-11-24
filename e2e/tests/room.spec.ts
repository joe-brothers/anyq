import { expect, test, type Browser, type Page } from "@playwright/test";

async function createRoom(page: Page) {
	const res = await page.request.post("/api/v1/rooms", { data: {} });
	expect(res.status()).toBe(201);
	return (await res.json()) as { id: string; token: string };
}

/** 저장소가 따로라 추천인이 다른 사람이 된다. */
async function visitor(browser: Browser, path: string) {
	const page = await (await browser.newContext({ locale: "ko-KR" })).newPage();
	await page.goto(path);
	return page;
}

async function ask(page: Page, text: string, name?: string) {
	if (name !== undefined) await page.getByLabel("이름").fill(name);
	await page.locator("#q").fill(text);
	await page.getByRole("button", { name: "올리기" }).click();
}

test("랜딩에서 방을 만들면 발표자 화면으로 간다", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "방 만들기" }).click();
	await expect(page).toHaveURL(/\/r\/[a-z0-9]{6}\/host#k=[0-9a-f]{32}$/);
	await expect(page.getByRole("heading", { name: "공유" })).toBeVisible();
});

test("없는 방은 404", async ({ page }) => {
	const res = await page.goto("/r/zzzzzz");
	expect(res?.status()).toBe(404);
	await expect(page.getByText("방을 찾지 못했습니다")).toBeVisible();
});

test("질문, 추천, 답변 공개가 화면마다 전달된다", async ({ page, browser }) => {
	const { id, token } = await createRoom(page);
	await page.goto(`/r/${id}/host#k=${token}`);
	const a = await visitor(browser, `/r/${id}`);
	const b = await visitor(browser, `/r/${id}`);
	const screen = await visitor(browser, `/r/${id}/screen`);

	await ask(a, "PDF는 몇 MB까지 올릴 수 있나요?", "철수");
	const hostQ = page.locator("#qs > li", { hasText: "PDF는 몇 MB까지" });
	await expect(hostQ).toBeVisible();
	await expect(hostQ.locator(".by")).toHaveText("철수");
	await expect(screen.locator(".by")).toHaveText("철수");

	// 발표자가 한글로 답을 쓰는 동안 추천이 들어와도 입력칸은 그대로다.
	const ta = hostQ.locator("textarea");
	await ta.pressSequentially("파일 하나에 ");
	await ta.evaluate((el) => ((el as HTMLElement & { mark?: boolean }).mark = true));
	const size = () => hostQ.locator(".qtext").evaluate((el) => getComputedStyle(el).fontSize);
	const before = await size();
	await b.getByRole("button", { name: /추천/ }).click();
	await expect(hostQ.locator(".vote b")).toHaveText("1");
	await expect(ta).toBeFocused();
	expect(await ta.evaluate((el) => (el as HTMLElement & { mark?: boolean }).mark)).toBe(true);
	await expect.poll(size).not.toBe(before);
	await ta.pressSequentially("10MiB까지입니다.");
	await expect(ta).toHaveValue("파일 하나에 10MiB까지입니다.");

	await hostQ.getByRole("button", { name: "공개", exact: true }).click();
	await expect(a.locator(".answer-pub")).toContainText("파일 하나에 10MiB까지입니다.");

	// 답변 중인 질문은 프로젝터 맨 위에 온다.
	await hostQ.getByRole("button", { name: "답변 시작" }).click();
	await expect(screen.locator("#qs > li").first()).toHaveClass(/live/);

	// 프로젝터의 이름은 발표자가 끌 수 있다. 청중 화면에는 남는다.
	await page.getByRole("button", { name: "프로젝터에 이름" }).click();
	await expect(screen.locator(".by")).toHaveCount(0);
	await expect(a.locator(".by")).toHaveText("철수");
});

test("확인 후 표시를 켜면 발표자가 연 질문만 나온다", async ({ page, browser }) => {
	const { id, token } = await createRoom(page);
	await page.goto(`/r/${id}/host#k=${token}`);
	const a = await visitor(browser, `/r/${id}`);
	await page.getByRole("button", { name: "확인 후 표시" }).click();
	await expect(page.getByRole("button", { name: "확인 후 표시" })).toHaveAttribute(
		"aria-pressed",
		"true",
	);

	await ask(a, "로그인해야 하나요?");
	await expect(a.getByText("발표자가 확인하면 표시됩니다.")).toBeVisible();
	await expect(a.locator("#qs > li")).toHaveCount(0);

	const held = page.locator(".hidden-box li", { hasText: "로그인해야 하나요?" });
	await held.getByRole("button", { name: "되돌리기" }).click();
	await expect(a.locator("#qs > li", { hasText: "로그인해야 하나요?" })).toBeVisible();
});

test("발표자 키가 틀리면 조작할 수 없다", async ({ page }) => {
	const { id } = await createRoom(page);
	await page.goto(`/r/${id}/host#k=wrong`);
	await expect(page.getByText("발표자 주소가 맞지 않습니다")).toBeVisible();
	await expect(page.getByRole("heading", { name: "공유" })).toHaveCount(0);
});
