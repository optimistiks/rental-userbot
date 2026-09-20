# What the owner tunes lives in files, re-read on every Post

The Watchlist, the Criteria, the Prompt and the Zone are files on the bind-mounted `data/` directory, read fresh from disk on every Post. None of them is an environment variable, and none is cached. Because a restart is a hole in coverage ([ADR-0001](0001-only-look-forward.md)), anything the owner adjusts routinely has to be adjustable without one — and adjusting the watchlist, the most routine change there is, was the one edit that used to cost Posts.

File watching was rejected rather than overlooked. The bot is a Linux container reading a bind mount from macOS Docker Desktop, which does not propagate host filesystem events into the container, so `fs.watch`, chokidar and watchman would all have to be configured to poll to work at all. That is strictly more machinery than reading a few kilobytes at the top of each Post.

## Consequences

- Reading the Watchlist is total: a line counts only if it is a marked channel ID, everything else is ignored without complaint, and a file that cannot be read at all means "watch nothing". No edit to that file can take the bot down, and `#` comments and labels work for free.
- A file missing at startup is fatal and named; the same file vanishing under a running bot is not. The two mean different things — an incomplete setup versus a `mv` that will probably be undone in a second — and only the first is worth refusing to run over.
- The owner's confirmation that an edit was picked up is a Notice in Saved Messages, on the next Post the account sees. A change is meaning, not bytes: the Watchlist's channel-ID set, the trimmed Criteria and Prompt, the Zone's polygons and names. Several files in one gap share one Notice.
- An unreadable Criteria, Prompt or Zone is a ⚠️ Notice about the file, and no Listing is judged until it reads again. A vanished Watchlist is still "watch nothing", a healthy Notice.
- The startup Notice reports Watchlist size, not join state. A dialog scan is a bad membership test: channels can deliver Posts without appearing in `iterDialogs`, which produced a `watching 0/2; not joined` Notice while those channels were already live. The owner joins in Telegram; the Watchlist does not join it.
