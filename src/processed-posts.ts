import Database from "better-sqlite3";

import type { Post } from "./telegram.js";

import { BOT_DATABASE_PATH } from "./config.js";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS processed_posts (
    post_key TEXT PRIMARY KEY,
    processed_at INTEGER NOT NULL
  )
`;

type PostIdentity = Pick<Post, "chatId" | "messageIds" | "albumId">;

interface ProcessedPosts {
  /**
   * Runs `work` for a Post that is neither processed nor already queued or being evaluated,
   * then records it as a Processed Post whether `work` succeeded or threw
   * (ADR-0002). A copy that arrives meanwhile, or later, is turned away at once.
   */
  once: (post: PostIdentity, work: () => Promise<void>) => Promise<void>;
  close: () => void;
}

/** Identity is per Post, not per message: an album is one key. */
function postKey(post: PostIdentity): string {
  if (post.albumId !== undefined) {
    return `${post.chatId}:album:${post.albumId}`;
  }

  return `${post.chatId}:${post.messageIds[0]}`;
}

function openProcessedPosts(databasePath: string = BOT_DATABASE_PATH): ProcessedPosts {
  const database = new Database(databasePath);
  database.exec(SCHEMA);

  const findPost = database.prepare("SELECT 1 FROM processed_posts WHERE post_key = ? LIMIT 1");
  const insertPost = database.prepare(
    "INSERT OR IGNORE INTO processed_posts (post_key, processed_at) VALUES (?, ?)",
  );
  // Posts queued or being evaluated, so a second copy never waits behind or runs alongside the first.
  const inFlight = new Set<string>();

  return {
    close() {
      database.close();
    },
    async once(post, work) {
      const key = postKey(post);
      if (inFlight.has(key) || findPost.get(key) !== undefined) {
        return;
      }

      inFlight.add(key);
      try {
        await work();
      } finally {
        // Released first, so a failed write cannot leave the Post held until a restart.
        inFlight.delete(key);
        insertPost.run(key, Date.now());
      }
    },
  };
}

export { type ProcessedPosts, openProcessedPosts };
