declare global {
	interface Window {
		turnstile?: { render(el: HTMLElement, opts: Record<string, unknown>): void };
	}
}

// Turnstile 스크립트는 필요할 때만 불러온다.
export const loadTurnstile = () =>
	new Promise<void>((ok, fail) => {
		if (window.turnstile) return ok();
		const s = document.createElement("script");
		s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
		s.onload = () => ok();
		s.onerror = fail;
		document.head.append(s);
	});
