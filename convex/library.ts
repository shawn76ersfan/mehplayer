import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const repeat = v.union(v.literal("off"), v.literal("all"), v.literal("one"));

export const getState = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const userId = identity.subject;
    const playback = await ctx.db
      .query("playback")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(1);
    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(300);
    return {
      playback: playback[0] ?? null,
      favoriteTrackIds: favorites.map((row) => row.trackId),
    };
  },
});

export const savePlayback = mutation({
  args: {
    collectionId: v.number(),
    trackId: v.number(),
    volume: v.number(),
    muted: v.boolean(),
    shuffle: v.boolean(),
    repeat,
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const userId = identity.subject;
    const existing = await ctx.db
      .query("playback")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(1);
    const fields = {
      userId,
      collectionId: args.collectionId,
      trackId: args.trackId,
      volume: args.volume,
      muted: args.muted,
      shuffle: args.shuffle,
      repeat: args.repeat,
      updatedAt: Date.now(),
    };
    if (existing[0]) {
      await ctx.db.patch(existing[0]._id, fields);
      return existing[0]._id;
    }
    return await ctx.db.insert("playback", fields);
  },
});

export const toggleFavorite = mutation({
  args: { trackId: v.number() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const userId = identity.subject;
    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_user_track", (q) =>
        q.eq("userId", userId).eq("trackId", args.trackId),
      )
      .take(1);
    if (existing[0]) {
      await ctx.db.delete(existing[0]._id);
      return false;
    }
    await ctx.db.insert("favorites", { userId, trackId: args.trackId });
    return true;
  },
});

export const ensureFavorite = mutation({
  args: { trackId: v.number() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const userId = identity.subject;
    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_user_track", (q) =>
        q.eq("userId", userId).eq("trackId", args.trackId),
      )
      .take(1);
    if (existing[0]) return existing[0]._id;
    return await ctx.db.insert("favorites", { userId, trackId: args.trackId });
  },
});
