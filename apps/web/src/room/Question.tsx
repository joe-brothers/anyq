import type { Question, Status } from "@anyq/protocol";
import { DraftBlock } from "./Draft.tsx";
import { Icon } from "./Icon.tsx";
import { mine, opts, role, send, tr } from "./store.ts";

const ACTIONS: Record<Exclude<Status, "hidden">, [Status, string, string][]> = {
	open: [
		["live", "play", "act.live"],
		["done", "check", "act.done"],
		["hidden", "eyeoff", "act.hide"],
	],
	live: [
		["done", "check", "act.done"],
		["open", "undo", "act.cancel"],
	],
	done: [
		["open", "undo", "act.reopen"],
		["hidden", "eyeoff", "act.hide"],
	],
};

/** 프로젝터에서는 발표자가 끄면 이름을 가린다. */
const showNames = () => role !== "screen" || opts.value.names;

export function Item({ q }: { q: Question }) {
	const hiddenQ = q.status === "hidden";
	const voted = mine.value.has(q.id);
	const flat = role === "screen" || q.status === "done" || hiddenQ;
	// 추천 수가 글자 크기다. 같은 노드를 유지하므로 크기 전환이 보인다.
	const k = q.status === "done" || hiddenQ ? "0" : Math.sqrt(q.votes).toFixed(2);
	const set = (status: Status) => send({ t: "set", id: q.id, status });

	return (
		<li class={q.status} tabIndex={role === "host" ? -1 : undefined} data-qid={q.id}>
			{flat ? (
				<div class="count">
					<Icon name="up" />
					<b>{q.votes}</b>
				</div>
			) : (
				<button
					type="button"
					class="vote"
					aria-pressed={voted}
					aria-label={tr("vote.label", tr(voted ? "unvote" : "vote"), q.votes, q.text)}
					onClick={() => send({ t: "vote", id: q.id })}
				>
					<Icon name="up" />
					<b>{q.votes}</b>
				</button>
			)}
			<p class="qtext" style={{ "--k": k }}>
				{q.text}
				{q.name && showNames() && <span class="by">{q.name}</span>}
				{q.status === "live" && <span class="tag">{tr("live.tag")}</span>}
				{q.status === "done" && (
					<span class="tag">
						<Icon name="check" /> {tr("done.tag")}
					</span>
				)}
			</p>
			{hiddenQ && (
				<div class="acts side">
					<button type="button" class="btn" onClick={() => set("open")}>
						<Icon name="undo" />
						{tr("act.unhide")}
					</button>
				</div>
			)}
			{!hiddenQ && !!q.similar?.length && (
				<details class="similar">
					<summary>{tr("similar", q.similar.length)}</summary>
					<ul>
						{q.similar.map((s) => (
							<li key={s.id}>
								<span>
									{s.text}
									{s.name && showNames() && <span class="by">{s.name}</span>}
								</span>
								{role === "host" && (
									<button type="button" class="btn" onClick={() => send({ t: "split", id: s.id })}>
										<Icon name="split" />
										{tr("split")}
									</button>
								)}
							</li>
						))}
					</ul>
				</details>
			)}
			{role === "host" && !hiddenQ && q.near && (
				<div class="near">
					<p>
						<b>{tr("near")}</b> {q.near.text}
					</p>
					<div class="acts">
						<button
							type="button"
							class="btn"
							onClick={() => send({ t: "merge", id: q.id, into: q.near!.id })}
						>
							<Icon name="merge" />
							{tr("merge")}
						</button>
						<button type="button" class="btn" onClick={() => send({ t: "keep", id: q.id })}>
							<Icon name="split" />
							{tr("keep")}
						</button>
					</div>
				</div>
			)}
			{role !== "host" && !hiddenQ && q.answer && (
				<div class="answer-pub">
					<p>{q.answer.text}</p>
					{q.answer.sources.length > 0 && (
						<p class="src-label">
							<Icon name="file" /> {q.answer.sources.join(", ")}
						</p>
					)}
				</div>
			)}
			{role === "host" && q.status !== "hidden" && (
				<DraftBlock q={q}>
					{ACTIONS[q.status].map(([status, ic, label]) => (
						<button type="button" class="btn" key={status} onClick={() => set(status)}>
							<Icon name={ic} />
							{tr(label)}
						</button>
					))}
				</DraftBlock>
			)}
		</li>
	);
}
