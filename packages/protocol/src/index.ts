// 웹과 API가 함께 쓰는 계약. 따로 배포되므로 어긋나면 PROTOCOL_VERSION으로 알아챈다.
import * as v from "valibot";

/** 메시지 모양이 호환되지 않게 바뀌면 올린다. */
export const PROTOCOL_VERSION = 1;

export const LIMITS = {
	textMin: 2,
	textMax: 200,
	nameMax: 20,
	answerMax: 1000,
	fileBytes: 10 * 1024 * 1024,
	/** 이보다 오래 만드는 중인 초안은 실패로 본다. */
	pendingMs: 90_000,
} as const;

export const ROOM_ID = /^[a-hjkmnp-z2-9]{6}$/;
export const VOTER_ID = /^[\w-]{8,64}$/;
export const FILE_TYPES = /\.(pdf|txt|md)$/i;
export const instanceId = (roomId: string) => "anyq-" + roomId;

const line = v.pipe(
	v.string(),
	v.transform((s) => s.replace(/\s+/g, " ").trim()),
);
const id = v.pipe(v.number(), v.integer());

export const StatusSchema = v.picklist(["open", "live", "done", "hidden"]);
export type Status = v.InferOutput<typeof StatusSchema>;

/** 방 옵션. review: 발표자가 연 질문만 보인다. names: 프로젝터에 이름을 띄운다. auto: 거의 같은 질문을 바로 묶는다. */
export const OptKeySchema = v.picklist(["review", "names", "auto"]);
export type Opts = Record<v.InferOutput<typeof OptKeySchema>, boolean>;

export const ClientMsgSchema = v.variant("t", [
	// 연결하면 가장 먼저 보낸다. k는 발표자 키.
	v.object({
		t: v.literal("hello"),
		v: v.number(),
		k: v.optional(v.pipe(v.string(), v.maxLength(128))),
	}),
	v.object({
		t: v.literal("ask"),
		text: v.pipe(line, v.minLength(LIMITS.textMin), v.maxLength(LIMITS.textMax)),
		name: v.optional(v.pipe(line, v.maxLength(LIMITS.nameMax))),
	}),
	v.object({ t: v.literal("vote"), id }),
	v.object({ t: v.literal("opt"), key: OptKeySchema, on: v.boolean() }),
	v.object({ t: v.literal("set"), id, status: StatusSchema }),
	v.object({ t: v.literal("draft"), id }),
	v.object({
		t: v.literal("approve"),
		id,
		text: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(LIMITS.answerMax)),
	}),
	v.object({ t: v.literal("unapprove"), id }),
	v.object({ t: v.literal("merge"), id, into: id }),
	v.object({ t: v.literal("split"), id }),
	v.object({ t: v.literal("keep"), id }),
]);
export type ClientMsg = v.InferOutput<typeof ClientMsgSchema>;

export const CreateRoomSchema = v.object({
	token: v.optional(v.pipe(v.string(), v.maxLength(2048))),
});

export type Answer = { text: string; sources: string[] };
export type Similar = { id: number; text: string; name?: string };
/** similar: 이 질문에 묶인 비슷한 질문. near: 묶을지 발표자가 정할 후보(발표자에게만 보낸다). kept: 따로 두기로 했지만 나중에 합칠 수 있게 남긴 후보. */
export type Question = {
	id: number;
	text: string;
	name?: string;
	votes: number;
	status: Status;
	answer?: Answer;
	similar?: Similar[];
	near?: Similar & { kept?: true };
};
/** at: 근거가 있는 곳(가장 가까운 제목). */
export type Source = { key: string; text: string; at?: string };
/** pending: 만드는 중, ready: 초안 있음, none: 자료에 없음, error: 실패 */
export type Draft = {
	status: "pending" | "ready" | "none" | "error";
	text: string;
	sources: Source[];
	approved: boolean;
};

export type ErrCode = "length" | "slow" | "full" | "key" | "version";
export type ServerMsg =
	| {
			t: "state";
			host: boolean;
			qs: Question[];
			mine: number[];
			files: number;
			opts: Opts;
			drafts: Record<number, Draft>;
	  }
	| { t: "q"; q: Question }
	| { t: "del"; id: number }
	| { t: "mine"; id: number; mine: boolean }
	| { t: "draft"; id: number; d: Draft }
	| { t: "files"; n: number }
	| { t: "opts"; opts: Opts }
	| { t: "asked"; held: boolean }
	| { t: "err"; code: ErrCode };

// REST. 웹은 늘 같은 출처의 API_BASE를 부른다.
export const API_BASE = "/api/v1";
export type Config = { sitekey: string };
export type CreatedRoom = { id: string; token: string };
export type RoomInfo = { host: boolean; files: number; expires: number };
export type FileItem = { key: string; status: string };
