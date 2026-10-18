/**
 * pi-think-hard — max effort for one turn.
 *
 * Start a prompt with `+` and that turn runs at a high thinking level (and
 * optionally on another model). The `+` is stripped before the model sees it;
 * the session's thinking level and model are restored when the turn ends.
 *
 *   ❯ +plan the refactor of the parser
 *
 * Configuration, first match wins:
 *   1. `/think-hard config <provider/model>/<level>` (persisted across sessions)
 *   2. `--think-level` / `--think-model` CLI flags
 *   3. `PI_THINK_LEVEL` / `PI_THINK_MODEL` env vars
 *   4. Defaults: session model, level `max`
 *
 * `/think-hard` shows the current config; `/think-hard reset` clears it.
 *
 * Inspired by midudev/better-claude (plugins/think-hard).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, Model, ModelRegistry, ThinkingLevel } from "@earendil-works/pi-coding-agent";

const MARK = "+";
const DEFAULT_LEVEL: ThinkingLevel = "max";
const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

interface PersistedConfig {
	model?: string; // "provider/model-id" or "model-id"
	level?: ThinkingLevel;
}

function configPath(): string {
	const home = process.env.PI_HOME ?? path.join(os.homedir(), ".pi", "agent");
	return path.join(home, "extensions-config", "think-hard.json");
}

function loadConfig(): PersistedConfig {
	try {
		return JSON.parse(fs.readFileSync(configPath(), "utf8")) as PersistedConfig;
	} catch {
		return {};
	}
}

function saveConfig(config: PersistedConfig): void {
	try {
		fs.mkdirSync(path.dirname(configPath()), { recursive: true });
		fs.writeFileSync(configPath(), JSON.stringify(config, null, "\t") + "\n");
	} catch {
		// read-only home: config stays per-session
	}
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

	function levelSpec(): ThinkingLevel {
		const persisted = loadConfig().level;
		if (persisted && LEVELS.includes(persisted)) return persisted;
		const flag = pi.getFlag("think-level");
		if (typeof flag === "string" && LEVELS.includes(flag.trim() as ThinkingLevel)) {
			return flag.trim() as ThinkingLevel;
		}
		const env = process.env.PI_THINK_LEVEL;
		if (env && LEVELS.includes(env.trim() as ThinkingLevel)) return env.trim() as ThinkingLevel;
		return DEFAULT_LEVEL;
	}

	function modelSpec(): string | undefined {
		const persisted = loadConfig().model;
		if (persisted) return persisted;
		const flag = pi.getFlag("think-model");
		if (typeof flag === "string" && flag.trim()) return flag.trim();
		const env = process.env.PI_THINK_MODEL;
		if (env && env.trim()) return env.trim();
		return undefined;
	}

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

		const spec = modelSpec();
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
		pi.setThinkingLevel(levelSpec());
	});

	pi.on("agent_end", async () => {
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
	});

	pi.registerFlag("think-level", {
		description: "Thinking level for + prompts (off|minimal|low|medium|high|xhigh|max)",
		type: "string",
	});
	pi.registerFlag("think-model", {
		description: "Optional model for + prompts (provider/model-id or model-id)",
		type: "string",
	});

	pi.registerCommand("think-hard", {
		description: "Configure + prompts: /think-hard [config <provider/model>/<level> | reset]",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);

			if (parts.length === 0) {
				const spec = modelSpec();
				ctx.ui.notify(
					`+ prompts: ${spec ? `${spec} · ` : "session model · "}thinking ${levelSpec()}`,
					"info",
				);
				return;
			}

			if (parts[0] === "reset") {
				saveConfig({});
				ctx.ui.notify("+ prompts: config cleared (session model, thinking max)", "info");
				return;
			}

			if (parts[0] === "config" && parts[1]) {
				const config = loadConfig();
				// Accept "provider/model/level", "provider/model", "model/level" is
				// ambiguous — use last segment only if it's a valid level.
				const segments = parts[1].split("/").filter(Boolean);
				let level: ThinkingLevel | undefined;
				if (segments.length >= 2 && LEVELS.includes(segments[segments.length - 1] as ThinkingLevel)) {
					level = segments.pop() as ThinkingLevel;
				}
				const modelSpecArg = segments.join("/");
				if (!modelSpecArg) {
					ctx.ui.notify(`No model in "${parts[1]}"`, "error");
					return;
				}
				const model = resolveModel(ctx.modelRegistry, modelSpecArg);
				if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) {
					ctx.ui.notify(`Model "${modelSpecArg}" not available`, "error");
					return;
				}
				config.model = modelSpecArg;
				if (level) config.level = level;
				if (parts[2] && LEVELS.includes(parts[2] as ThinkingLevel)) config.level = parts[2] as ThinkingLevel;
				saveConfig(config);
				ctx.ui.notify(
					`+ prompts: ${model.provider}/${model.id} · thinking ${config.level ?? levelSpec()}`,
					"info",
				);
				return;
			}

			ctx.ui.notify("Usage: /think-hard [config <provider/model>/<level> | reset]", "error");
		},
	});
}
