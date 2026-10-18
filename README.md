# pi-think-hard

Prefix a prompt with `+` and that turn runs at a high thinking level.
The `+` is stripped before the model sees it; the session's thinking level
(and optionally model) is restored when the turn ends.

```text
❯ +plan the refactor of the parser
```

## Configuring the thinking level

First match wins:

1. `/think <level>` during the session (`/think` shows current config)
2. `--think-level <level>` CLI flag
3. `PI_THINK_LEVEL` env var
4. Default: `max`

Levels: `off|minimal|low|medium|high|xhigh|max` — clamped by pi to what the
model supports.

## Optional model switch

By default `+` prompts keep the session's model. To run them on another one:

1. `/think model <model>` (`/think model` resets to session model)
2. `--think-model <provider/model-id | model-id>` CLI flag
3. `PI_THINK_MODEL` env var

```bash
pi --think-level high --think-model zai/glm-5.3
```

## Details

- Works in interactive mode and headless prompts.
- Models without extended thinking are left alone (pi clamps the level).
- `+` alone doesn't hijack the input.

## Install

```bash
pi install git:https://github.com/kcurtet/pi-think-hard
```

## How it works

- `input` event: detects the leading `+`, marks the turn, strips the mark.
- `agent_start`: saves current level/model, applies the configured ones.
- `agent_end`: restores the previous level/model.

Inspired by [midudev/better-claude](https://github.com/midudev/better-claude)
(`think-hard` plugin).

MIT © kcurtet
