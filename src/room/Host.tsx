import { FILE_TYPES, LIMITS } from "@anyq/protocol";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { getLang } from "../client/ui.ts";
import { Icon } from "./Icon.tsx";
import {
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
	const fileErrs = useSignal<[string, string][]>([]);
	const over = useSignal(false);

	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(audience);
			copy.value = ["check", "copied"];
		} catch {
			copy.value = ["warn", "copyfail"];
		}
		setTimeout(() => (copy.value = ["copy", "copy"]), 2000);
	};
	const add = async (list: File[]) => {
		if (uploading.value || !list.length) return;
		const errs: [string, string][] = [];
		fileErrs.value = errs;
		for (const [i, file] of list.entries()) {
			uploading.value = list.length > 1 ? `${file.name} (${i + 1}/${list.length})` : file.name;
			const err = !FILE_TYPES.test(file.name)
				? "up.415"
				: file.size > LIMITS.fileBytes
					? "up.413"
					: await upload(file);
			if (err) fileErrs.value = [...fileErrs.value, [file.name, err]];
		}
		uploading.value = null;
	};
	const onFile = (e: Event) => {
		const input = e.currentTarget as HTMLInputElement;
		const list = [...(input.files ?? [])];
		input.value = "";
		void add(list);
	};
	const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
	const onDrag = (e: DragEvent) => {
		if (!hasFiles(e)) return;
		e.preventDefault();
		over.value = true;
	};
	const onLeave = (e: DragEvent) => {
		if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) over.value = false;
	};
	const onDrop = (e: DragEvent) => {
		if (!hasFiles(e)) return;
		e.preventDefault();
		over.value = false;
		void add([...e.dataTransfer!.files]);
	};
	// 패널을 빗나간 파일을 브라우저가 열어 발표자 화면을 떠나지 않게 한다.
	useEffect(() => {
		const stop = (e: DragEvent) => hasFiles(e) && e.preventDefault();
		addEventListener("dragover", stop);
		addEventListener("drop", stop);
		return () => {
			removeEventListener("dragover", stop);
			removeEventListener("drop", stop);
		};
	}, []);

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

			<section
				class="panel drop"
				aria-labelledby="mat-h"
				data-over={over.value || undefined}
				onDragEnter={onDrag}
				onDragOver={onDrag}
				onDragLeave={onLeave}
				onDrop={onDrop}
			>
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
						multiple
						disabled={!!uploading.value}
						onChange={onFile}
					/>
					<span class="note">{tr(over.value ? "mat.drop" : "mat.hint")}</span>
				</div>
				{fileErrs.value.length > 0 && (
					<ul class="err" role="alert">
						{fileErrs.value.map(([name, err]) => (
							<li key={name}>
								{name}: {tr(err)}
							</li>
						))}
					</ul>
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

const OPTS = ["review", "names", "auto"] as const;

/** 단축키 안내. 공개 키는 OS에 맞춰 적는다(동작은 둘 다 받는다). */
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
const KEYS: [string[], string][] = [
	[["J", "K"], "key.move"],
	[["L"], "act.live"],
	[["D"], "act.done"],
	[["E"], "key.write"],
	[[MOD, "Enter"], "approve"],
];

/** 질문 수와 방 옵션 */
export function Bar() {
	const list = shown.value;
	const open = useSignal(false);
	return (
		<>
			<div class="bar">
				<p class="total">
					{list.length > 0 &&
						tr("total", list.length, list.filter((q) => q.status === "done").length)}
				</p>
				<button
					class="btn"
					type="button"
					aria-expanded={open.value}
					aria-controls="opts"
					onClick={() => (open.value = !open.value)}
				>
					<Icon name="sliders" />
					{tr("opt.h")}
				</button>
			</div>
			<ul class="opts" id="opts" hidden={!open.value}>
				{OPTS.map((key) => (
					<li key={key}>
						<button
							class="switch"
							type="button"
							role="switch"
							aria-checked={opts.value[key]}
							aria-label={tr("opt." + key)}
							aria-describedby={"opt-" + key}
							onClick={() => send({ t: "opt", key, on: !opts.value[key] })}
						>
							<span>
								<b>{tr("opt." + key)}</b>
								<span class="note" id={"opt-" + key}>
									{tr("opt." + key + ".d")}
								</span>
							</span>
							<i class="track" aria-hidden="true" />
						</button>
					</li>
				))}
			</ul>
			<ul class="note keys">
				{KEYS.map(([keys, label]) => (
					<li key={label}>
						{keys.map((k) => (
							<kbd key={k}>{k}</kbd>
						))}
						{tr(label)}
					</li>
				))}
			</ul>
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
