import Database from "better-sqlite3";

import type { Post } from "./telegram.js";

import { BOT_DATABASE_PATH } from "./config.js";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS processed_posts (
    post_key TEXT PRIMARY KEY,
    processed_at INTEGER NOT NULL
  )
`;

interface DedupeStore {
  isProcessed: (postKey: string) => boolean;
  markProcessed: (postKey: string) => void;
  close: () => void;
}

function postKey(post: Pick<Post, "chatId" | "messageIds" | "albumId">): string {
  if (post.albumId !== undefined) {
    return `${post.chatId}:album:${post.albumId}`;
  }

  return `${post.chatId}:${post.messageIds[0]}`;
}

function openDedupeStore(databasePath: string = BOT_DATABASE_PATH): DedupeStore {
  const database = new Database(databasePath);
  database.exec(SCHEMA);

  const findPost = database.prepare("SELECT 1 FROM processed_posts WHERE post_key = ? LIMIT 1");
  const insertPost = database.prepare(
    "INSERT OR IGNORE INTO processed_posts (post_key, processed_at) VALUES (?, ?)",
  );

  return {
    close() {
      database.close();
    },
    isProcessed(postKey) {
      return findPost.get(postKey) !== undefined;
    },
    markProcessed(postKey) {
      insertPost.run(postKey, Date.now());
    },
  };
}

export { type DedupeStore, postKey, openDedupeStore };
