import { assert, describe, expect, it, vi } from "vitest";

import type { PhotoRef } from "./telegram.js";

import { readListing } from "./listing.js";
import { WATCHED_CHANNEL_ID, post, quiet } from "./test-support.js";

type Download = (ref: PhotoRef) => Promise<Uint8Array>;

function downloadingBytes(): ReturnType<typeof vi.fn<Download>> {
  return vi.fn<Download>((ref) => Promise.resolve(new TextEncoder().encode(JSON.stringify(ref))));
}

describe("readListing", () => {
  it("makes a Listing of a Post with text and at least three photos", () => {
    expect.hasAssertions();

    const read = readListing(post(1, { text: "Flat for rent" }), downloadingBytes());

    expect(read).toMatchObject({
      listing: {
        chatId: WATCHED_CHANNEL_ID,
        link: "https://t.me/example/1",
        text: "Flat for rent",
      },
    });
  });

  it.each([
    ["no text and one photo", "", ["photo-1"], "1 photo, no text"],
    ["text but fewer than three photos", "Сдается квартира Батуми", ["photo-1"], "1 photo"],
    [
      "three photos but only whitespace",
      "  \n",
      ["photo-1", "photo-2", "photo-3"],
      "3 photos, no text",
    ],
    ["no photos and no text", "", [], "0 photos, no text"],
  ])("skips a Post with %s and says why", (_case, text, photos: PhotoRef[], skipped) => {
    expect.hasAssertions();

    expect(readListing(post(2, { photos, text }), downloadingBytes())).toStrictEqual({ skipped });
  });

  it("downloads at most six photos, in the Post's order, only when asked", async () => {
    expect.hasAssertions();
    const download = downloadingBytes();
    const photos = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];

    const read = readListing(post(3, { photos }), download);

    expect(download).not.toHaveBeenCalled();
    assert("listing" in read);
    const bytes = await read.listing.photos();
    expect(bytes.map((photo) => new TextDecoder().decode(photo))).toStrictEqual(
      photos.slice(0, 6).map((ref) => JSON.stringify(ref)),
    );
  });

  it("leaves out a photo that fails to download and keeps the rest", async () => {
    expect.hasAssertions();
    const warn = quiet("warn");
    const download = downloadingBytes().mockRejectedValueOnce(new Error("expired file reference"));

    const read = readListing(post(4), download);
    assert("listing" in read);

    await expect(read.listing.photos()).resolves.toHaveLength(2);
    expect(warn).toHaveBeenCalledWith(
      "post https://t.me/example/4: skipped photo: expired file reference",
    );
  });
});
