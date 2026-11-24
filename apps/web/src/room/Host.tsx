import { FILE_TYPES, LIMITS } from "@anyq/protocol";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { getLang } from "../client/ui.ts";
import { Icon } from "./Icon.tsx";
import {
	drafts,
	expires,
	fileItems,
	fileNote,
	opts,
	qs,
	roomId,
	send,
	shown,
	tr,
	upload,
} from "./store.ts";

const FILE_ICON: Record<string, string> = {
	queued: "spin",
	running: "spin",
	completed: "check",
	error: "warn",
};

/** 공유 주소와 발표 자료 */
export function Panels() {
	const audience = location.origin + "/r/" + roomId;
	const copy = useSignal<[string, string]>(["copy", "copy"]);
	const uploading = useSignal<string | null>(null);
	const fileErr = useSignal<string | null>(null);

	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(audience);
			copy.value = ["check", "copied"];
		} catch {
			copy.value = ["warn", "copyfail"];
		}
		setTimeout(() => (copy.value = ["copy", "copy"]), 2000);
	};
	const onFile = async (e: Event) => {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		fileErr.value = null;
		if (!FILE_TYPES.test(file.name)) return void (fileErr.value = "up.415");
		if (file.size > LIMITS.fileBytes) return void (fileErr.value = "up.413");
		uploading.value = file.name;
		fileErr.value = await upload(file);
		input.value = "";
		uploading.value = null;
	};

	return (
		<div class="panels">
			<section class="panel" aria-labelledby="share-h">
				<h2 id="share-h">{tr("share.h")}</h2>
				<div class="row">
					<a class="url" href={audience}>
						{audience.replace(/^https?:\/\//, "")}
					</a>
					<button class="btn" type="button" onClick={onCopy}>
						<Icon name={copy.value[0]} />
						{tr(copy.value[1])}
					</button>
					<a class="btn" href={audience + "/screen"} target="_blank" rel="noopener">
						<Icon name="screen" />
						{tr("share.screen")}
					</a>
				</div>
				<p class="note">
					<Icon name="lock" />
					<span>{tr("share.note")}</span>
				</p>
				{expires.value > 0 && (
					<p class="note">{tr("expires", new Date(expires.value).toLocaleDateString(getLang()))}</p>
				)}
			</section>

			<section class="panel" aria-labelledby="mat-h">
				<h2 id="mat-h">{tr("mat.h")}</h2>
				<div class="row">
					<label class="btn" for="file" id="file-label">
						<Icon name={uploading.value ? "spin" : "upload"} />
						{uploading.value ? tr("mat.uploading", uploading.value) : tr("mat.upload")}
					</label>
					<input
						class="sr"
						id="file"
						type="file"
						accept=".pdf,.txt,.md"
						disabled={!!uploading.value}
						onChange={onFile}
					/>
					<span class="note">{tr("mat.hint")}</span>
				</div>
				{fileErr.value && (
					<p class="err" role="alert">
						{tr(fileErr.value)}
					</p>
				)}
				<ul class="files">
					{fileItems.value.map((f) => (
						<li key={f.key}>
							<span>
								<Icon name="file" /> {f.key}
							</span>
							<span class="file-status">
								{FILE_ICON[f.status] && <Icon name={FILE_ICON[f.status]!} />} {tr("fs." + f.status)}
							</span>
						</li>
					))}
				</ul>
				{fileNote.value && (
					<p class="note" role="status">
						{tr(fileNote.value)}
					</p>
				)}
			</section>
		</div>
	);
}

/** 질문과 공개한 답변을 Markdown으로 내려받는다. */
function exportMd() {
	const all = [...qs.value.values()]
		.filter((q) => q.status !== "hidden")
		.sort((a, b) => b.votes - a.votes || a.id - b.id);
	const kind = (id: number) => {
		const d = drafts.value.get(id);
		return d?.approved ? "answered" : d?.status === "none" ? "missing" : "rest";
	};
	const by = (name?: string) => (name ? " — " + name : "");
	const out = ["# " + tr("title.room", roomId), ""];
	for (const sec of ["answered", "missing", "rest"]) {
		const rows = all.filter((q) => kind(q.id) === sec);
		if (!rows.length) continue;
		out.push("## " + tr("ex." + sec), "");
		for (const q of rows) {
			out.push("- " + q.text + by(q.name) + " (" + tr("ex.votes", q.votes) + ")");
			for (const s of q.similar ?? []) out.push("  - " + s.text + by(s.name));
			if (sec === "answered")
				out.push("", "  " + drafts.value.get(q.id)!.text.replace(/\n/g, "\n  "), "");
		}
		out.push("");
	}
	const a = document.createElement("a");
	a.href = URL.createObjectURL(new Blob([out.join("\n")], { type: "text/markdown" }));
	a.download = "anyq-" + roomId + ".md";
	a.click();
	URL.revokeObjectURL(a.href);
}

/** 질문 수, 방 옵션, 내보내기 */
export function Bar() {
	const list = shown.value;
	const toggle = (key: "review" | "names", ic: [string, string]) => (
		<button
			class="btn"
			type="button"
			aria-pressed={opts.value[key]}
			onClick={() => send({ t: "opt", key, on: !opts.value[key] })}
		>
			<Icon name={opts.value[key] ? ic[0] : ic[1]} />
			{tr(key === "review" ? "review" : "opt.names")}
		</button>
	);
	return (
		<>
			<div class="bar">
				<p class="total">
					{list.length > 0 &&
						tr("total", list.length, list.filter((q) => q.status === "done").length)}
				</p>
				{toggle("review", ["lock", "eye"])}
				{toggle("names", ["eye", "eyeoff"])}
				<button class="btn" type="button" onClick={exportMd}>
					<Icon name="download" />
					{tr("export")}
				</button>
			</div>
			<p class="note keys">{tr("keys")}</p>
		</>
	);
}

/** 발표자 단축키. 한글 입력 상태에서도 되게 e.code로 본다. */
export function useShortcuts() {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
			if (target.closest("input, textarea, select")) return;
			const li = target.closest<HTMLElement>("#qs > li");
			if (e.code === "KeyJ" || e.code === "KeyK") {
				const items = [...document.querySelectorAll<HTMLElement>("#qs > li")];
				const i = (li ? items.indexOf(li) : -1) + (e.code === "KeyJ" ? 1 : -1);
				const next = items[Math.max(0, Math.min(items.length - 1, i))];
				next?.focus();
				next?.scrollIntoView({ block: "nearest" });
				return;
			}
			const q = li && qs.value.get(Number(li.dataset.qid));
			if (!q) return;
			if (e.code === "KeyL" && q.status !== "done")
				send({ t: "set", id: q.id, status: q.status === "live" ? "open" : "live" });
			else if (e.code === "KeyD" && q.status !== "done")
				send({ t: "set", id: q.id, status: "done" });
			else if (e.code === "KeyE") {
				e.preventDefault();
				li.querySelector("textarea")?.focus();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);
}
