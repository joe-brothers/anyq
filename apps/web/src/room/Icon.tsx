import { ICONS } from "../client/ui.ts";

export function Icon({ name }: { name: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			class={name === "spin" ? "ico spin" : "ico"}
			aria-hidden="true"
			dangerouslySetInnerHTML={{ __html: ICONS[name] ?? "" }}
		/>
	);
}
