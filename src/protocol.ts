export type Status = "open" | "live" | "done" | "hidden";
export type Answer = { text: string; sources: string[] };
export type Similar = { id: number; text: string };
/** similar: 이 질문에 묶인 비슷한 질문. near: 묶을지 발표자가 정할 후보(발표자에게만 보낸다). */
export type Question = {
	id: number;
	text: string;
	votes: number;
	status: Status;
	answer?: Answer;
	similar?: Similar[];
	near?: Similar;
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

export type ClientMsg =
	| { t: "auth"; k: string }
	| { t: "review"; on: boolean }
	| { t: "ask"; text: string }
	| { t: "vote"; id: number }
	| { t: "set"; id: number; status: Status }
	| { t: "draft"; id: number }
	| { t: "approve"; id: number; text: string }
	| { t: "unapprove"; id: number }
	| { t: "merge"; id: number; into: number }
	| { t: "split"; id: number }
	| { t: "keep"; id: number };

export type ServerMsg =
	| {
			t: "state";
			host: boolean;
			qs: Question[];
			mine: number[];
			files: number;
			review: boolean;
			drafts: Record<number, Draft>;
	  }
	| { t: "q"; q: Question }
	| { t: "del"; id: number }
	| { t: "mine"; id: number; mine: boolean }
	| { t: "draft"; id: number; d: Draft }
	| { t: "files"; n: number }
	| { t: "review"; on: boolean }
	| { t: "asked"; held: boolean }
	| { t: "err"; code: "length" | "slow" | "full" | "key" };

export const ROOM_ID = /^[a-hjkmnp-z2-9]{6}$/;
export const VOTER_ID = /^[\w-]{8,64}$/;
export const FILE_TYPES = /\.(pdf|txt|md)$/i;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const instanceId = (roomId: string) => "anyq-" + roomId;
