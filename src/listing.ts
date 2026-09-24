import type { PhotoRef, Post } from "./telegram.js";

import { errorMessage } from "./errors.js";

const MIN_LISTING_PHOTOS = 3;
const MAX_LISTING_PHOTOS = 6;

/** A Post assembled for evaluation: its text, up to six photos, and a link back to it. */
interface Listing {
  chatId: number;
  link: string;
  text: string;
  /** Downloads the photos on each call, leaving out any that fail. */
  photos: () => Promise<Uint8Array[]>;
}

type ListingRead = { listing: Listing } | { skipped: string };

/** A Post is a Listing when it has post text and at least three photos; any other Post is skipped. */
function readListing(
  post: Post,
  downloadPhoto: (ref: PhotoRef) => Promise<Uint8Array>,
): ListingRead {
  const hasText = post.text.trim() !== "";
  if (!hasText || post.photos.length < MIN_LISTING_PHOTOS) {
    const count = post.photos.length;
    const photos = `${count} photo${count === 1 ? "" : "s"}`;
    return { skipped: hasText ? photos : `${photos}, no text` };
  }

  const refs = post.photos.slice(0, MAX_LISTING_PHOTOS);
  return {
    listing: {
      chatId: post.chatId,
      link: post.link,
      photos: () => downloadPhotos(refs, post.link, downloadPhoto),
      text: post.text,
    },
  };
}

async function downloadPhotos(
  refs: readonly PhotoRef[],
  link: string,
  downloadPhoto: (ref: PhotoRef) => Promise<Uint8Array>,
): Promise<Uint8Array[]> {
  const photos: Uint8Array[] = [];

  for (const ref of refs) {
    try {
      /* The Telegram adapter makes one call at a time anyway (ADR-0006). */
      // oxlint-disable-next-line no-await-in-loop
      photos.push(await downloadPhoto(ref));
    } catch (error) {
      console.warn(`post ${link}: skipped photo: ${errorMessage(error)}`);
    }
  }

  return photos;
}

export { type Listing, type ListingRead, readListing };
