import type { Post } from "./telegram.js";

export function isWatchedPost(post: Pick<Post, "chatId">, channelIds: readonly number[]): boolean {
  return channelIds.includes(post.chatId);
}
