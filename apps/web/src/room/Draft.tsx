import { LIMITS, type Question } from "@anyq/protocol";
import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { Icon } from "./Icon.tsx";
import { drafts, edits, files, send, stale, tr } from "./store.ts";

const STATE: Record<string, [string | null, string]> = {
	ready: ["eyeoff", "st.draft"],
	none: [null, "st.none"],
	error: ["warn", "st.error"],
};

/** 초안과 근거. children은 질문 상태를 바꾸는 버튼이다. */
export function DraftBlock({ q, children }: { q: Question; children: ComponentChildren }) {
	const ta = useRef<HTMLTextAreaElement>(null);
	const raw = drafts.value.get(q.id);
	const d = raw && stale(q.id) ? { ...raw, status: "error" as const } : raw;
	const hasFiles = files.value > 0;

	const approve = () => {
		const el = ta.current;
		if (!el) return;
		const text = el.value.trim();
		el.toggleAttribute("aria-invalid", !text);
		if (!text) return el.focus();
		send({ t: "approve", id: q.id, text });
	};
	const [ic, label] = d
		? (STATE[d.status] ?? [null, ""])
		: [null, hasFiles ? "st.none" : "st.nofiles"];

	return (
		<div class="pair" data-state={d?.approved ? "public" : (d?.status ?? "empty")}>
			<div class="answer">
				{d?.approved ? (
					<>
						<p class="state">
							<Icon name="eye" />
							{tr("st.public")}
						</p>
						<p class="a">{d.text}</p>
					</>
				) : d?.status === "pending" ? (
					<p class="state">
						<Icon name="spin" />
						{tr("st.pending")}
					</p>
				) : (
					<>
						<p class="state">
							{ic && <Icon name={ic} />}
							{tr(label)}
						</p>
						{/* 값을 직접 묶지 않는다. 다시 그려도 한글 조합이 끊기지 않는다. */}
						<textarea
							ref={ta}
							key={d?.text ?? ""}
							rows={3}
							maxLength={LIMITS.answerMax}
							defaultValue={edits.get(q.id) ?? d?.text ?? ""}
							placeholder={tr("answer.ph")}
							aria-label={tr("answer.label", q.text)}
							onInput={(e) => edits.set(q.id, e.currentTarget.value)}
							onKeyDown={(e) => {
								if (e.isComposing) return;
								if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) approve();
								if (e.key === "Escape") e.currentTarget.closest("li")?.focus();
							}}
						/>
					</>
				)}
				<div class="acts">
					{d?.approved ? (
						<button type="button" class="btn" onClick={() => send({ t: "unapprove", id: q.id })}>
							<Icon name="eyeoff" />
							{tr("unapprove")}
						</button>
					) : (
						d?.status !== "pending" && (
							<>
								<button type="button" class="btn primary" onClick={approve}>
									<Icon name="eye" />
									{tr("approve")}
								</button>
								{hasFiles && (
									<button type="button" class="btn" onClick={() => send({ t: "draft", id: q.id })}>
										<Icon name="refresh" />
										{tr(d ? "redraft" : "mkdraft")}
									</button>
								)}
							</>
						)
					)}
					<span class="gap" />
					{children}
				</div>
			</div>
			{d?.status === "none" && !d.approved ? (
				<aside class="source missing" aria-label={tr("src.label")}>
					<p class="src-label">{tr("src.none")}</p>
				</aside>
			) : (
				!!d?.sources.length && (
					<aside class="source" aria-label={tr("src.label")}>
						{d.sources.map((s) => (
							<>
								<p class="src-label">
									<Icon name="file" /> {s.at ? s.key + " · " + s.at : s.key}
								</p>
								<blockquote>{s.text}</blockquote>
							</>
						))}
					</aside>
				)
			)}
		</div>
	);
}
