import { v } from "convex/values";
import { query } from "./_generated/server";

export const getArtist = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("artists")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
  },
});

export const listAlbums = query({
  args: { artistKey: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("albums")
      .withIndex("by_artist", (q) => q.eq("artistKey", args.artistKey))
      .take(40);
  },
});

export const tracksForAlbum = query({
  args: { collectionId: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tracks")
      .withIndex("by_album", (q) => q.eq("collectionId", args.collectionId))
      .take(60);
  },
});

export const searchTracks = query({
  args: { term: v.string() },
  handler: async (ctx, args) => {
    const term = args.term.trim().slice(0, 80);
    if (term.length === 0) return [];
    const tracks = await ctx.db
      .query("tracks")
      .withSearchIndex("search_title", (q) => q.search("title", term))
      .take(40);
    const albums = await ctx.db
      .query("albums")
      .withIndex("by_artist", (q) => q.eq("artistKey", "kanye-west"))
      .take(40);
    const titles = new Map(albums.map((album) => [album.collectionId, album.title]));
    return tracks.map((track) => ({
      collectionId: track.collectionId,
      trackId: track.trackId,
      title: track.title,
      previewUrl: track.previewUrl,
      durationMs: track.durationMs,
      trackNumber: track.trackNumber,
      discNumber: track.discNumber,
      explicit: track.explicit,
      albumTitle: titles.get(track.collectionId) ?? "",
    }));
  },
});

export const tracksByIds = query({
  args: { trackIds: v.array(v.number()) },
  handler: async (ctx, args) => {
    const ids = args.trackIds.slice(0, 80);
    const tracks = [];
    for (const trackId of ids) {
      const track = await ctx.db
        .query("tracks")
        .withIndex("by_track", (q) => q.eq("trackId", trackId))
        .unique();
      if (track) tracks.push(track);
    }
    return tracks;
  },
});
