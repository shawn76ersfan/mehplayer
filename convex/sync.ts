import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation } from "./_generated/server";
import { ALBUMS, ARTIST } from "./allowlist";

type ItunesTrack = {
  wrapperType?: string;
  kind?: string;
  trackId: number;
  trackName: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  trackNumber?: number;
  discNumber?: number;
  trackExplicitness?: string;
  artworkUrl100?: string;
};

function upscale(url?: string) {
  if (!url) return "";
  return url.replace(/\/\d+x\d+bb(?=\.)/, "/1000x1000bb");
}

export const upsertArtist = internalMutation({
  args: {
    key: v.string(),
    name: v.string(),
    imageUrl: v.string(),
    imageCredit: v.string(),
    itunesArtistId: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("artists")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("artists", args);
  },
});

export const replaceAlbum = internalMutation({
  args: {
    artistKey: v.string(),
    collectionId: v.number(),
    title: v.string(),
    credit: v.string(),
    releaseDate: v.string(),
    year: v.number(),
    artworkUrl: v.string(),
    primary: v.string(),
    secondary: v.string(),
    ink: v.string(),
    sortKey: v.number(),
    tracks: v.array(
      v.object({
        trackId: v.number(),
        title: v.string(),
        previewUrl: v.string(),
        durationMs: v.number(),
        trackNumber: v.number(),
        discNumber: v.number(),
        explicit: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("albums")
      .withIndex("by_collection", (q) => q.eq("collectionId", args.collectionId))
      .unique();
    const album = {
      artistKey: args.artistKey,
      collectionId: args.collectionId,
      title: args.title,
      credit: args.credit,
      releaseDate: args.releaseDate,
      year: args.year,
      artworkUrl: args.artworkUrl,
      primary: args.primary,
      secondary: args.secondary,
      ink: args.ink,
      sortKey: args.sortKey,
    };
    if (existing) await ctx.db.patch(existing._id, album);
    else await ctx.db.insert("albums", album);

    const previous = await ctx.db
      .query("tracks")
      .withIndex("by_album", (q) => q.eq("collectionId", args.collectionId))
      .take(80);
    for (const track of previous) await ctx.db.delete(track._id);
    for (const track of args.tracks) {
      await ctx.db.insert("tracks", {
        collectionId: args.collectionId,
        ...track,
      });
    }
    return args.tracks.length;
  },
});

export const syncCatalog = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.sync.upsertArtist, ARTIST);
    const summary: { title: string; tracks: number }[] = [];

    for (const album of ALBUMS) {
      const response = await fetch(
        `https://itunes.apple.com/lookup?id=${album.collectionId}&entity=song&limit=200`,
      );
      if (!response.ok) {
        summary.push({ title: album.title, tracks: 0 });
        continue;
      }
      const json = (await response.json()) as { results: ItunesTrack[] };
      const artwork = json.results.find((row) => row.artworkUrl100)?.artworkUrl100;
      const tracks = json.results
        .filter(
          (row) => row.wrapperType === "track" && row.kind === "song" && row.previewUrl,
        )
        .sort(
          (a, b) =>
            (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
            (a.trackNumber ?? 0) - (b.trackNumber ?? 0),
        )
        .map((row) => ({
          trackId: row.trackId,
          title: row.trackName,
          previewUrl: row.previewUrl as string,
          durationMs: row.trackTimeMillis ?? 0,
          trackNumber: row.trackNumber ?? 0,
          discNumber: row.discNumber ?? 1,
          explicit: row.trackExplicitness === "explicit",
        }));

      await ctx.runMutation(internal.sync.replaceAlbum, {
        artistKey: ARTIST.key,
        collectionId: album.collectionId,
        title: album.title,
        credit: album.credit,
        releaseDate: album.releaseDate,
        year: Number(album.releaseDate.slice(0, 4)),
        artworkUrl: upscale(artwork),
        primary: album.primary,
        secondary: album.secondary,
        ink: album.ink,
        sortKey: Date.parse(`${album.releaseDate}T00:00:00Z`),
        tracks,
      });
      summary.push({ title: album.title, tracks: tracks.length });
    }

    return summary;
  },
});
