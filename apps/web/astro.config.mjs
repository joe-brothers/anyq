import cloudflare from "@astrojs/cloudflare";
import preact from "@astrojs/preact";
import { defineConfig } from "astro/config";

export default defineConfig({
	// 방 화면은 요청 때 그린다. 랜딩만 미리 빌드한다(prerender).
	output: "server",
	// 이미지 변환을 쓰지 않으므로 Images 바인딩을 만들지 않는다.
	adapter: cloudflare({ imageService: "passthrough" }),
	integrations: [preact()],
	server: { port: 4321 },
	devToolbar: { enabled: false },
});
