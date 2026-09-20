import type { Post } from "./telegram.js";

function isWatchedPost(post: Pick<Post, "chatId">, channelIds: readonly number[]): boolean {
  return channelIds.includes(post.chatId);
}

export { isWatchedPost };
