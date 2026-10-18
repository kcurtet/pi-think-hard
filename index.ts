/**
 * pi-think-hard — max effort for one turn.
 *
 * Start a prompt with `+` and that turn runs at a high thinking level.
 * The `+` is stripped before the model sees it; the session's thinking level
 * (and optionally model) is restored when the turn ends.
 *
 *   ❯ +plan the refactor of the parser
 *
 * Level resolution (first match wins):
 *   1. `/think <level>` during the session
 *   2. `--think-level <level>` CLI flag
 *   3. `PI_THINK_LEVEL` env var
 *   4. Default: `max`
 *
 * Optional model switch, same order, unset by default (keep session model):
 *   1. `/think model <model>`
 *   2. `--think-model <provider/model-id | model-id>`
 *   3. `PI_THINK_MODEL` env var
 *
 * Thinking level is clamped by pi to model capabilities. The `+` alone
 * doesn't hijack the input.
 *
 * Inspired by midudev/better-claude (plugins/think-hard).
 */
import type { ExtensionAPI, Model, ModelRegistry, ThinkingLevel } from "@earendil-works/pi-coding-agent";

const MARK = "+";
const DEFAULT_LEVEL: ThinkingLevel = "max";
const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

let runtimeLevel: ThinkingLevel | undefined; // set by /think during a session
let runtimeModelSpec: string | undefined;

function levelSpec(pi: ExtensionAPI): ThinkingLevel {
	if (runtimeLevel) return runtimeLevel;
	const flag = pi.getFlag("think-level");
	if (typeof flag === "string" && LEVELS.includes(flag.trim() as ThinkingLevel)) {
		return flag.trim() as ThinkingLevel;
	}
	const env = process.env.PI_THINK_LEVEL;
	if (env && LEVELS.includes(env.trim() as ThinkingLevel)) return env.trim() as ThinkingLevel;
	return DEFAULT_LEVEL;
}

function modelSpec(pi: ExtensionAPI): string | undefined {
	if (runtimeModelSpec) return runtimeModelSpec;
	const flag = pi.getFlag("think-model");
	if (typeof flag === "string" && flag.trim()) return flag.trim();
	const env = process.env.PI_THINK_MODEL;
	if (env && env.trim()) return env.trim();
	return undefined;
}

function resolveModel(registry: ModelRegistry, spec: string): Model<any> | undefined {
	if (spec.includes("/")) {
		const idx = spec.indexOf("/");
		return registry.find(spec.slice(0, idx), spec.slice(idx + 1));
	}
	const candidates = registry.getAll().filter((m) => m.id === spec);
	return (
		candidates.find((m) => registry.hasConfiguredAuth(m)) ?? candidates[0]
	);
}

export default function thinkHardExtension(pi: ExtensionAPI) {
	let hardTurn = false;
	let previousLevel: ThinkingLevel | undefined;
	let previousModel: Model<any> | undefined;

	pi.on("input", async (event) => {
		if (event.source !== "interactive" && event.source !== "extension") return;
		if (!event.text.startsWith(MARK)) return;

		const text = event.text.slice(MARK.length).trimStart();
		if (!text) return; // "+" alone: don't hijack the input

		hardTurn = true;
		return { action: "transform" as const, text };
	});

	pi.on("agent_start", async (_event, ctx) => {
		if (!hardTurn) return;

		const spec = modelSpec(pi);
		if (spec) {
			const model = resolveModel(ctx.modelRegistry, spec);
			if (model && ctx.modelRegistry.hasConfiguredAuth(model)) {
				previousModel = ctx.model;
				const ok = await pi.setModel(model);
				if (!ok) previousModel = undefined;
			}
		}

		previousLevel = pi.getThinkingLevel();
		// Clamped to model capabilities by pi itself.
		pi.setThinkingLevel(levelSpec(pi));
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!hardTurn) return;
		hardTurn = false;
		if (previousLevel !== undefined) {
			pi.setThinkingLevel(previousLevel);
			previousLevel = undefined;
		}
		if (previousModel !== undefined) {
			await pi.setModel(previousModel);
			previousModel = undefined;
		}
		if (ctx.hasUI) ctx.ui.notify(`⚡ Answered with thinking: ${levelSpec(pi)}`, "info");
	});

	pi.registerFlag("think-level", {
		description: "Thinking level for + prompts (off|minimal|low|medium|high|xhigh|max)",
		type: "string",
	});
	pi.registerFlag("think-model", {
		description: "Optional model for + prompts (provider/model-id or model-id)",
		type: "string",
	});

	pi.registerCommand("think", {
		description: "Show or set the thinking level/model used for + prompts",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			if (parts.length === 0) {
				const spec = modelSpec(pi);
				ctx.ui.notify(
					`+ prompts: thinking ${levelSpec(pi)}${spec ? ` on ${spec}` : " (session model" + ")"}`,
					"info",
				);
				return;
			}
			if (parts[0] === "model") {
				if (parts.length < 2) {
					runtimeModelSpec = undefined; // reset: keep session model
					ctx.ui.notify("+ prompts keep the session model", "info");
					return;
				}
				const model = resolveModel(ctx.modelRegistry, parts[1]);
				if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) {
					ctx.ui.notify(`Model "${parts[1]}" not available`, "error");
					return;
				}
				runtimeModelSpec = parts[1];
				ctx.ui.notify(`+ prompts run on ${model.provider}/${model.id}`, "info");
				return;
			}
			const level = parts[0] as ThinkingLevel;
			if (!LEVELS.includes(level)) {
				ctx.ui.notify(`Invalid level "${level}". Use: ${LEVELS.join("|")}`, "error");
				return;
			}
			runtimeLevel = level;
			ctx.ui.notify(`+ prompts use thinking ${level}`, "info");
		},
	});
}
