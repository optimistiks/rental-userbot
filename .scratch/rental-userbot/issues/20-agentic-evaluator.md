# Agentic Evaluator

Type: grilling
Status: resolved
Blocked by: 21

## Question

The owner wants the Evaluator to be an agent: it gets the Post text and photos plus tools (a geocoder and a Zone check), and it makes the whole decision, like a human would. This replaces the fixed design from [Judging the district from a Post's address](12-district-judgement.md): one model call, a `places` list, and a code-side Zone veto. What exactly is the agent's contract?

- Who owns the final Verdict, and whether any code override remains.
- The tool set and tool shapes, kept independent of LocationIQ so the geocoder can be swapped.
- Run limits (steps, timeout) and how the 3-attempt retry applies to an agent run.
- Where warnings/notes come from.
- How agent runs are tested.
- Which build tickets and spec sections change.

Later, and out of scope for v0: a separate vision step that extracts photo facts for a text-only agent.

## Answer

Decided with the owner (2026-09-20), on the facts in [Agentic Evaluator facts](21-agentic-evaluator-facts.md) and a live smoke test. This supersedes the fixed design in [Judging the district from a Post's address](12-district-judgement.md) and parts of [Evaluator contract and failure classes](06-evaluator-contract.md).

**The agent owns the Verdict**
- One `generateText` agent run per attempt: Post text + photos in, tools available, `{ match: boolean, notes: string }` out. `reason`, `places` and the code-side Zone veto are gone; **no code decision can change a Verdict**.
- The Zone is now only a tool the agent may call. The **Zone veto** glossary entry is removed and **Zone** is reworded ([CONTEXT.md](../../CONTEXT.md)).
- Notifier: Match → `<link>\n<notes>`. Evaluation failure → unchanged ⚠️. No match → nothing.

**Tools** (shapes are ours, so the geocoder can be swapped; the adapter maps LocationIQ onto them and appends ", Batumi")
```ts
geocode(query: string) → { results: Array<{ precision: 'building'|'place'|'street'|'area', lat: number, lon: number, label: string }> } | { error: string }
inZone(lat: number, lon: number) → { inside: boolean, zone: string | null }   // zone = the matching outline's name
```
- LocationIQ `matchlevel` maps to `precision`: building→`building`, venue→`place`, street→`street`, anything coarser→`area`. `GEOCODER_URL` stays a setting and only the adapter knows it.
- Tool errors come back to the model as results (the SDK turns a thrown error into a tool error and continues), so the agent can retry a different spelling. A Zone file read failure is also a tool error, not a crash.
- The Zone file is still validated at startup and re-read on every `inZone` call.

**The prompt is a file**, `data/prompt.md` (`PROMPT_PATH`), re-read before every run, with the Criteria appended after it. A starting copy ships in `data.example/`; a missing file crashes startup. Its starting text (owner's wording):
1. Look at every photo. Write down everything relevant to the specified criteria. Pay attention to location, e.g. landmarks visible from the apartment windows. A location determined from a photo is more trustworthy than a location specified in the post details.
2. Read the post text. Write down everything relevant to the specified criteria.
3. Use the available tools to determine the location of the apartment.
4. Make the final decision based on the information you've collected.

Kept as decision rules in the prompt: rental offers only; lenient matching; `notes` in the Criteria's language. Tools are **not** described in the prompt; their zod definitions carry the descriptions. No location hints (Latin-spelling tricks etc.); the agent works it out.

**Run limits**
- `stopWhen: isStepCount(8)`, with `prepareStep` forcing `toolChoice: 'none'` on the last allowed step so it must produce the JSON (otherwise `NoOutputGeneratedError`).
- `timeout: 180_000` for the whole run; a per-tool limit (10s) turns a slow geocoder call into a tool error instead of killing the run.
- The 3-attempt policy is unchanged, but an attempt is now a whole run: 3 runs, 2s/4s backoff. `NoOutputGeneratedError`/`NoObjectGeneratedError` count as failed attempts. Tool errors do not.
- Reasoning summaries are enabled so the agent's thinking is visible in the trace.

**Observability: Sentry** (new)
- AI monitoring (agent runs as traces: steps, tool calls, tokens, cost) plus error reporting. Prompts and outputs are captured, so Criteria and Post text do leave the laptop; accepted.
- Per-Post console lines stay, so `docker compose logs` works when Sentry doesn't.
- `SENTRY_DSN` is optional. Without it Sentry is off and the bot behaves exactly as before; tests stay offline. Sentry is fire-and-forget and never blocks or crashes a run.

**Testing**
- Agent runs are tested with `MockLanguageModelV4` from `ai/test`, scripted step by step (tool call, then final JSON). The model is injected into the Evaluator. This replaces the msw AI Gateway fixtures for the Evaluator; msw stays for LocationIQ.
- Automated tests can only prove plumbing now: tools wired, adapter mapping, Zone file reading, `{ match, notes }` reaching the Notifier, retries and failure formatting.
- "A Post outside the Zone is rejected" becomes a **manual** acceptance check. An eval harness of recorded Posts with expected verdicts is a follow-on, out of scope for v0.

**Live smoke test (2026-09-20, owner's key, `ai@7.0.107`, `google/gemini-3.8-flash`)**
- Tools + `Output.object` in one call were accepted; no fallback `submitVerdict` tool is needed.
- Given the DS Mall Post text (no photos), the agent called `geocode("DS Mall Tbeli Abuseridze")`, then `inZone(41.6400004, 41.622037)` on the returned point, then answered `{ match: false, notes: "…outside Old Town and Rustaveli district…" }`: the correct Verdict, with no code veto.
- 3 steps, 9.1s, 2,011 input / 447 output tokens (332 of them reasoning).
- Intermediate steps produced **no visible text** (hidden reasoning), which is why reasoning summaries are switched on.

