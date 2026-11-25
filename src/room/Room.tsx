import { LIMITS } from "@anyq/protocol";
import { useSignal, useSignalEffect } from "@preact/signals";
import { createPortal } from "preact/compat";
import { useEffect, useRef } from "preact/hooks";
import { Bar, Panels, useShortcuts } from "./Host.tsx";
import { Icon } from "./Icon.tsx";
import { Item } from "./Question.tsx";
import {
	askErr,
	asked,
	conn,
	hidden,
	live,
	notice,
	opts,
	ready,
	send,
	shown,
	start,
	tr,
	type Role,
} from "./store.ts";

/** 머리말의 방 코드와 연결 상태. 평소에는 방 코드만, 문제가 있을 때만 상태를 보인다. 섬 밖에 있는 자리에 그린다. */
function Conn({ id }: { id: string }) {
	const slot = document.getElementById("conn");
	const { key, kind } = conn.value;
	useEffect(() => {
		slot?.toggleAttribute("data-bad", kind === "bad");
	}, [kind]);
	if (!slot) return null;
	return createPortal(
		<>
			{kind !== "ok" && <Icon name={kind === "ing" ? "spin" : "warn"} />}
			{kind === "ok" ? (
				<>
					{id}
					<span class="sr">{tr(key)}</span>
				</>
			) : (
				tr(key)
			)}
		</>,
		slot,
	);
}

function Ask() {
	const input = useRef<HTMLInputElement>(null);
	const name = useRef<HTMLInputElement>(null);
	const invalid = useSignal(false);
	// 접수되면 질문 칸만 비운다. 이름은 남긴다.
	useSignalEffect(() => {
		if (asked.value && input.current) input.current.value = "";
	});
	const onSubmit = (e: Event) => {
		e.preventDefault();
		const text = input.current!.value.trim();
		if (text.length < LIMITS.textMin) {
			askErr.value = "err.length";
			invalid.value = true;
			return input.current!.focus();
		}
		const who = name.current!.value.trim();
		localStorage.setItem("anyq-name", who);
		send({ t: "ask", text, ...(who ? { name: who } : {}) });
	};
	const clear = () => {
		askErr.value = null;
		invalid.value = false;
	};
	return (
		<form class="ask dock" novalidate onSubmit={onSubmit}>
			<label for="q">{tr("ask.label")}</label>
			<div class="ask-row">
				<input
					ref={name}
					class="name"
					name="name"
					type="text"
					maxLength={LIMITS.nameMax}
					autocomplete="nickname"
					defaultValue={localStorage.getItem("anyq-name") ?? ""}
					placeholder={tr("name.ph")}
					aria-label={tr("name.label")}
				/>
				<input
					ref={input}
					id="q"
					name="q"
					type="text"
					maxLength={LIMITS.textMax}
					autocomplete="off"
					placeholder={tr("ask.ph")}
					aria-describedby="q-err"
					aria-invalid={invalid.value || undefined}
					onInput={clear}
				/>
				<button class="btn primary" type="submit">
					{tr("ask.submit")}
				</button>
			</div>
			<p class="err" id="q-err" role="alert">
				{askErr.value && tr(askErr.value)}
			</p>
		</form>
	);
}

function Join({ id }: { id: string }) {
	const url = location.origin + "/r/" + id;
	const svg = useSignal("");
	// QR 라이브러리는 프로젝터에서만 쓰므로 여기서 불러온다. 청중 화면에는 실리지 않는다.
	useEffect(() => {
		void import("qrcode-generator").then(({ default: qrcode }) => {
			const code = qrcode(0, "M");
			code.addData(url);
			code.make();
			svg.value = code.createSvgTag({ scalable: true, margin: 0 });
		});
	}, [url]);
	return (
		<aside class="join" aria-label={tr("join")}>
			{/* QR은 라이브러리가 만든 SVG 문자열이다. */}
			<div
				class="qr"
				role="img"
				aria-label={tr("qr.label")}
				dangerouslySetInnerHTML={{ __html: svg.value }}
			/>
			<p>{tr("join")}</p>
			<p class="join-url">{url.replace(/^https?:\/\//, "")}</p>
		</aside>
	);
}

export default function Room({ id, role }: { id: string; role: Role }) {
	useEffect(() => void start(id, role), []);
	useEffect(() => void (document.title = tr("title.room", id)));
	if (role === "host") useShortcuts();
	const hiddenOpen = useSignal(false);
	// 확인 후 표시를 켜면 기다리는 질문이 바로 보이게 펼친다.
	useSignalEffect(() => {
		if (opts.value.review) hiddenOpen.value = true;
	});

	const list = shown.value;
	const held = hidden.value;
	const usable = ready.value && !notice.value;
	const msg =
		notice.value ??
		(ready.value && !list.length ? (role === "audience" ? "q.empty.aud" : "q.empty") : null);

	return (
		<>
			<Conn id={id} />
			{role === "host" && usable && <Panels />}
			{role === "host" && usable && <Bar />}
			<div class="stage">
				<div class="list">
					{msg && (
						<p class="empty">
							{msg === "msg.loading" && <Icon name="spin" />} {tr(msg)}
						</p>
					)}
					<ol class="qs" id="qs" aria-labelledby="title">
						{list.map((q) => (
							<Item key={q.id} q={q} />
						))}
					</ol>
					{held.length > 0 && (
						<details
							class="hidden-box"
							open={hiddenOpen.value}
							onToggle={(e) => (hiddenOpen.value = e.currentTarget.open)}
						>
							<summary>{tr(opts.value.review ? "hidden.review" : "hidden.h", held.length)}</summary>
							<ol class="qs">
								{held.map((q) => (
									<Item key={q.id} q={q} />
								))}
							</ol>
						</details>
					)}
				</div>
				{role === "screen" && <Join id={id} />}
			</div>
			{role === "audience" && usable && <Ask />}
			<p class="sr" aria-live="polite">
				{live.value}
			</p>
		</>
	);
}
