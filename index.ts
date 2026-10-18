/**
 * pi-think-hard — max effort for one turn.
 *
 * Start a prompt with `+` and that turn runs at the highest thinking level
 * supported by the model. The `+` is stripped before the model sees it.
 *
 *   ❯ +plan the refactor of the parser
 *
 * Models without extended thinking are left alone (pi clamps the level to
 * model capabilities). The previous thinking level is restored when the turn
 * ends.
 *
 * Inspired by midudev/better-claude (plugins/think-hard).
 */
import type { ExtensionAPI, ThinkingLevel } from "@earendil-works/pi-coding-agent";

const MARK = "+";
const HARD_LEVEL: ThinkingLevel = "max";

export default function thinkHardExtension(pi: ExtensionAPI) {
	let hardTurn = false;
	let previousLevel: ThinkingLevel | undefined;

	pi.on("input", async (event) => {
		if (event.source !== "interactive" && event.source !== "extension") return;
		if (!event.text.startsWith(MARK)) return;

		const text = event.text.slice(MARK.length).trimStart();
		if (!text) return; // "+" alone: don't hijack the input

		hardTurn = true;
		return { action: "transform" as const, text };
	});

	pi.on("agent_start", async () => {
		if (!hardTurn) return;
		previousLevel = pi.getThinkingLevel();
		// Clamped to model capabilities by pi itself.
		pi.setThinkingLevel(HARD_LEVEL);
	});

	pi.on("agent_end", async () => {
		if (!hardTurn) return;
		hardTurn = false;
		if (previousLevel !== undefined) {
			pi.setThinkingLevel(previousLevel);
			previousLevel = undefined;
		}
	});
}
