export async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 걸린 시간으로 값을 짐작하지 못하게 비교한다. */
export function same(a: string, b: string): boolean {
	const x = new TextEncoder().encode(a);
	const y = new TextEncoder().encode(b);
	return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function randomId(): string {
	return Array.from(
		crypto.getRandomValues(new Uint8Array(6)),
		(b) => ALPHABET[b % ALPHABET.length],
	).join("");
}

export function randomToken(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}
