# Liveness signal

Type: grilling
Status: open
Blocked by: —

## Question

The bot is silent unless there's a Match or an evaluation failure, and it's down whenever the laptop sleeps. How does the owner know it's alive and watching?

Options: Docker logs only, as the spec has it. A short message to `me` on startup, listing the Watched channels found and missing. A periodic heartbeat. Or rule this out of scope for v0.
