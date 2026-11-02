import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  artists: defineTable({
    key: v.string(),
    name: v.string(),
    imageUrl: v.string(),
    imageCredit: v.string(),
    itunesArtistId: v.number(),
  }).index("by_key", ["key"]),

  albums: defineTable({
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
  })
    .index("by_artist", ["artistKey", "sortKey"])
    .index("by_collection", ["collectionId"]),

  tracks: defineTable({
    collectionId: v.number(),
    trackId: v.number(),
    title: v.string(),
    previewUrl: v.string(),
    durationMs: v.number(),
    trackNumber: v.number(),
    discNumber: v.number(),
    explicit: v.boolean(),
  })
    .index("by_album", ["collectionId", "discNumber", "trackNumber"])
    .index("by_track", ["trackId"])
    .searchIndex("search_title", {
      searchField: "title",
    }),

  favorites: defineTable({
    userId: v.string(),
    trackId: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_track", ["userId", "trackId"]),

  playback: defineTable({
    userId: v.string(),
    collectionId: v.number(),
    trackId: v.number(),
    volume: v.number(),
    muted: v.boolean(),
    shuffle: v.boolean(),
    repeat: v.union(v.literal("off"), v.literal("all"), v.literal("one")),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
});
