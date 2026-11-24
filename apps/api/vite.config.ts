import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
	plugins: [cloudflare()],
	// 웹 개발 서버가 /api를 이 포트로 넘긴다.
	server: { port: 8787, strictPort: true },
});
