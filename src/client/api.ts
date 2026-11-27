// 늘 같은 출처의 /api를 부른다. 응답 타입은 @anyq/protocol이 정한다.
import {
	API_BASE,
	type Config,
	type CreatedRoom,
	type FileItem,
	type RoomInfo,
} from "@anyq/protocol";

const bearer = (key: string | null): Record<string, string> =>
	key ? { authorization: "Bearer " + key } : {};

async function json<T>(res: Response): Promise<T> {
	if (!res.ok) throw new ApiError(res.status);
	return res.json();
}

export class ApiError extends Error {
	constructor(readonly status: number) {
		super("api " + status);
	}
}

export const api = {
	config: () => fetch(API_BASE + "/config").then(json<Config>),
	createRoom: (token?: string) =>
		fetch(API_BASE + "/rooms", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ token }),
		}).then(json<CreatedRoom>),
	join: async (id: string, voter: string, token: string) => {
		const res = await fetch(API_BASE + "/rooms/" + id + "/join", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ token, voter }),
		});
		if (!res.ok) throw new ApiError(res.status);
	},
	room: (id: string, key: string | null) =>
		fetch(API_BASE + "/rooms/" + id, { headers: bearer(key) }).then(json<RoomInfo>),
	files: (id: string, key: string | null) =>
		fetch(API_BASE + "/rooms/" + id + "/files", { headers: bearer(key) }).then(json<FileItem[]>),
	upload: (id: string, key: string | null, file: File) =>
		fetch(API_BASE + "/rooms/" + id + "/files", {
			method: "POST",
			headers: { ...bearer(key), "x-file-name": encodeURIComponent(file.name) },
			body: file,
		}),
	wsUrl: (id: string, voter: string) =>
		location.origin.replace(/^http/, "ws") + API_BASE + "/rooms/" + id + "/ws?v=" + voter,
};
