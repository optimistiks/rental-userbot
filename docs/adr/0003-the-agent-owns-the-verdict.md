# The agent owns the Verdict

Evaluation is one agent run: the Listing goes in, the agent reasons and calls the `locateInZone` tool as it sees fit, and it returns `{ match, notes }`. The tool geocodes a query and annotates every candidate with its Zone status. **No code decision can change what the agent decides.**

The design before this one was a single model call returning a match plus a street address, after which code geocoded the address and vetoed the match if the point fell outside the Zone. A real Post killed it: *"Квартира на улице Тбеля Абусеридзе в здании торгового центра DS Mall"* names a building, not a house number, so the address came back null, the veto never ran, and the lenient rule let a flat through from the wrong side of town. Every patch to that design was another rule about what the model should extract, which is work the model is better at doing itself — so it was given the tools and the decision.

## Considered options

A tool loop was proposed and rejected twice before it was accepted, on cost and on control: every step resends the photos, and a veto applied in code is a harder guarantee than a rule in a prompt. What changed is that the fixed design's guarantee turned out to be conditional on an extraction step that quietly failed, so it was not the stronger option it looked like. A live run on the DS Mall Post confirmed the agent located it, considered its Zone status and returned *no match* on its own.

## Consequences

- The Zone is an input the agent weighs, not a veto. There is no "Zone veto" in the glossary, and the district line stays in the Criteria alongside it.
- Automated tests can only prove plumbing — that the tools are wired, that the Verdict reaches the Notifier, that retries and failures are formatted right. Whether the agent judges well is checked by hand.
- Tool errors go back to the model as results so it can try another spelling. They are not attempt failures; only a run that produces no output is.
- Photos are resent on every step. Low media resolution limits their token cost, and combining geocoding with the Zone check removes one usual model step.
- The tool shapes are ours, not LocationIQ's, so the geocoder can be swapped by writing another adapter.
