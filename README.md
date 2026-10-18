# pi-think-hard

Prefix a prompt with `+` and that turn runs at the highest thinking level the
model supports. The `+` is stripped before the model sees it; the session's
thinking level is restored when the turn ends.

```text
❯ +plan the refactor of the parser
```

- Works in interactive mode and headless prompts.
- Models without extended thinking are left alone (pi clamps the level to model
  capabilities).
- `+` alone doesn't hijack the input.

Inspired by [midudev/better-claude](https://github.com/midudev/better-claude)
(`think-hard` plugin).

## Install

```bash
pi install git:https://github.com/kcurtet/pi-think-hard
```

## How it works

- `input` event: detects the leading `+`, marks the turn, strips the mark.
- `agent_start`: saves the current thinking level and sets it to `max`.
- `agent_end`: restores the previous level.

MIT © kcurtet
