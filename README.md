# anyQ

발표 자료로 먼저 답해 두는 실시간 Q&A 도구입니다.

청중은 QR로 들어와 묻고 추천합니다. anyQ는 발표자가 올린 자료에서 답변 초안과 근거를 찾아 발표자에게만 보여 주고, 발표자가 승인한 답만 청중에게 공개합니다. 자료에 답이 없으면 "자료에 없음"으로 표시합니다.

데모: https://anyq.joe-brothers.com

Cloudflare Developer Day Seoul 2026 Use Case 공모전 출품작입니다.

## 화면

| 주소                          | 누가     | 무엇을                                                           |
| ----------------------------- | -------- | ---------------------------------------------------------------- |
| `/`                           | 발표자   | 방을 만듭니다                                                    |
| `/r/<방코드>/host#k=<비밀키>` | 발표자   | 자료를 올리고, 초안을 고쳐 승인하고, 답변 중인 질문을 표시합니다 |
| `/r/<방코드>`                 | 청중     | 질문을 올리고 추천합니다. 계정은 필요 없습니다                   |
| `/r/<방코드>/screen`          | 프로젝터 | 질문과 참여 QR을 띄웁니다. 추천이 많을수록 글자가 커집니다       |

발표자 주소는 방을 만들 때 한 번만 나옵니다. 잃어버리면 그 방은 다시 조작할 수 없습니다. 비밀키는 `#` 뒤에 있어 서버 로그에 남지 않습니다.

발표자 화면에서는 `J`/`K`로 질문을 옮겨 다니고 `L` 답변 시작, `D` 완료, `E` 답변 쓰기, `Ctrl+Enter`(맥은 `⌘+Enter`) 공개를 쓸 수 있습니다. "방 옵션"에서 "확인 후 표시"를 켜면 발표자가 연 질문만 청중과 프로젝터에 나오고, "프로젝터에 이름"을 끄면 프로젝터에서 질문자 이름을 가립니다. "자동 합치기"를 끄면 거의 같은 질문도 바로 묶지 않고 합칠지 발표자에게 묻습니다.

## 구성

| 제품            | 하는 일                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Workers         | Worker 하나(`anyq`)가 화면과 API를 함께 냅니다                                                        |
| Durable Objects | 방 하나가 객체 하나입니다. 질문, 추천, 초안을 SQLite에 저장하고 WebSocket(hibernation)으로 전달합니다 |
| AI Search       | 방마다 인스턴스 하나(`anyq-<방코드>`)를 만들어 자료를 보관, 색인, 검색합니다                          |
| Workers AI      | 검색된 자료로 답변 초안을 쓰고(`@cf/openai/gpt-oss-120b`), 비슷한 질문을 묶고, 새 질문을 확인합니다   |
| Turnstile       | 방을 만들기 전에 사람인지 확인합니다(선택)                                                            |

```
src                 Astro. 랜딩은 미리 빌드하고, 방 화면은 요청 때 그린 뒤 Preact island가 맡습니다
src/worker.ts       Worker 진입점. /api/* 는 API로, 나머지는 Astro로 보냅니다
packages/api        Hono. REST(/api/v1)와 방 Durable Object
packages/protocol   화면과 API가 함께 쓰는 계약: valibot 스키마, 메시지 타입, 한도
e2e                 Playwright. 실제 브라우저로 질문 → 추천 → 공개 흐름을 확인합니다
DESIGN.md           디자인 원칙
```

화면과 API는 코드로는 나뉘어 있지만 Worker 하나로 배포됩니다. 브라우저는 늘 같은 출처의 `/api`만 부르므로 CORS와 API 주소 설정이 없습니다.

배포 뒤에도 예전 화면을 열어 둔 브라우저가 있을 수 있어서, WebSocket을 열 때 프로토콜 버전(`PROTOCOL_VERSION`)을 먼저 주고받습니다. 어긋나면 화면이 새로 고침을 안내합니다. 메시지 모양을 호환되지 않게 바꿀 때 이 값을 올립니다.

## 내 Cloudflare 계정에 배포하기

Node.js 22.23 이상과 pnpm이 필요합니다.

```sh
pnpm install
pnpm exec wrangler login
pnpm run deploy
```

배포가 끝나면 `https://anyq.<계정>.workers.dev` 주소가 나옵니다. 따로 만들어 둘 것은 없습니다. AI Search는 계정에 기본으로 있는 `default` 네임스페이스를 쓰고, Astro 어댑터가 쓰는 KV 네임스페이스(`SESSION`)는 처음 올릴 때 함께 만들어집니다.

### 내 도메인 붙이기 (선택)

배포할 때 도메인을 넘깁니다. 도메인의 zone이 같은 Cloudflare 계정에 있어야 합니다.

```sh
pnpm run deploy --domain anyq.example.com
```

### Turnstile 켜기 (선택)

`TURNSTILE_SECRET`이 없으면 사람 확인 없이 누구나 방을 만들 수 있습니다. 공개된 주소로 운영한다면 켜 두세요.

1. [Turnstile 대시보드](https://dash.cloudflare.com/?to=/:account/turnstile)에서 위젯을 만들고 배포한 주소를 호스트 이름에 넣습니다. `sitekey`와 `secret`이 나옵니다.
2. 둘 다 Worker의 비밀 값으로 넣습니다. 한 번 넣으면 다시 배포해도 유지됩니다.

   ```sh
   pnpm exec wrangler secret put TURNSTILE_SITEKEY
   pnpm exec wrangler secret put TURNSTILE_SECRET
   ```

## 로컬 개발

```sh
pnpm dev         # http://localhost:4321
pnpm test        # API 테스트 (Workers 런타임)
pnpm e2e         # 브라우저 테스트. 개발 서버가 떠 있어야 하고, 설치된 Chrome을 씁니다
pnpm typecheck   # 타입 검사
```

AI Search와 Workers AI는 로컬에서 돌지 않습니다. `pnpm dev`, `pnpm test`, `pnpm build`는 로그인한 계정에 원격으로 연결하므로, 먼저 `wrangler login`(테스트는 `pnpm --filter @anyq/api exec cf auth login`)이 되어 있어야 합니다. 로컬에서 만든 방의 자료와 인스턴스도 실제 계정에 생깁니다.

로컬에서 Turnstile 위젯까지 보려면 `.dev.vars.example`을 `.dev.vars`로 복사합니다. 항상 통과하는 테스트 키가 들어 있습니다.

`.astro` 파일의 머리말(frontmatter)은 타입 검사에서 빠져 있습니다. `astro check`가 아직 TypeScript 7을 지원하지 않습니다.

## 제한

- 자료는 PDF, TXT, MD만 올릴 수 있고 파일 하나에 10MiB까지입니다. 여러 개를 한 번에 고르거나 끌어다 놓을 수 있습니다.
- 색인에 시간이 걸립니다. 4.5KB 마크다운이 90초, 1.8MB PDF가 2분 30초쯤 걸렸습니다. 색인 전에 올라온 질문은 색인이 끝나면 초안이 생깁니다(한 번에 50개까지).
- 이름은 확인하지 않습니다. 누구나 아무 이름이나 적을 수 있습니다.
- 질문은 2자 이상 200자 이하, 한 사람이 5초에 하나, 방 하나에 300개까지입니다. 같은 IP에서는 1분에 질문 20개, 새 참여자 120명까지 받습니다. 발표장이 IP 하나를 함께 쓰는 경우를 생각해 넉넉하게 둔 값이라, 조작을 늦출 뿐 막지는 못합니다.
- 새 질문은 Workers AI(`@cf/meta/llama-guard-3-8b`) 확인을 거친 뒤 나옵니다. 걸린 질문은 발표자의 "숨김"으로 갑니다. 욕설을 모두 거르지는 못합니다.
- 추천은 브라우저마다 질문당 한 번입니다. 브라우저 저장소를 지우면 다시 추천할 수 있습니다.
- 방은 만든 지 7일 뒤에 질문, 자료, AI Search 인스턴스와 함께 지워집니다. 더 일찍 지우려면 대시보드나 `cf ai-search` 명령을 씁니다.
- AI Search는 2026-12-01부터 과금됩니다. 매달 의미 검색 1,000회와 색인 토큰 500만 개가 무료이고, 질문 하나가 검색 1회입니다. 최신 요금은 [AI Search 요금 문서](https://developers.cloudflare.com/ai-search/platform/limits-pricing/)를 확인하세요.

## 라이선스

[MIT](LICENSE)
