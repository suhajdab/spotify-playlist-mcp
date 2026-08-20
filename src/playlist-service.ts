import { randomUUID } from "node:crypto";
import { buildPlaylistChangeSet } from "./playlist-plan.js";
import type {
  PlaylistChangeRequest,
  PlaylistDetails,
  SpotifyGateway,
} from "./types.js";

export interface PlaylistServiceOptions {
  allowedPlaylistIds: Set<string>;
  maxChangesPerPlan: number;
  planTtlMs?: number;
  now?: () => number;
  createPlanId?: () => string;
}

interface StoredPlan {
  planId: string;
  playlist: PlaylistDetails;
  changes: ReturnType<typeof buildPlaylistChangeSet>;
  createdAt: number;
  expiresAt: number;
}

export class PlaylistService {
  readonly #plans = new Map<string, StoredPlan>();
  readonly #now: () => number;
  readonly #createPlanId: () => string;
  readonly #planTtlMs: number;

  constructor(
    private readonly spotify: SpotifyGateway,
    private readonly options: PlaylistServiceOptions
  ) {
    this.#now = options.now ?? Date.now;
    this.#createPlanId = options.createPlanId ?? randomUUID;
    this.#planTtlMs = options.planTtlMs ?? 10 * 60 * 1000;
  }

  async planChanges(request: PlaylistChangeRequest) {
    this.#assertAllowlisted(request.playlistId);
    const [userId, playlist, items] = await Promise.all([
      this.spotify.getCurrentUserId(),
      this.spotify.getPlaylistDetails(request.playlistId),
      this.spotify.getPlaylistItems(request.playlistId),
    ]);
    this.#assertOwned(playlist, userId);

    const changes = buildPlaylistChangeSet(
      items.map((item) => item.uri),
      request,
      this.options.maxChangesPerPlan
    );
    const createdAt = this.#now();
    const plannedPlaylist = { ...playlist };
    const plan: StoredPlan = {
      planId: this.#createPlanId(),
      playlist: plannedPlaylist,
      changes,
      createdAt,
      expiresAt: createdAt + this.#planTtlMs,
    };
    this.#plans.set(plan.planId, plan);

    return {
      planId: plan.planId,
      createdAt: new Date(plan.createdAt).toISOString(),
      expiresAt: new Date(plan.expiresAt).toISOString(),
      playlist: plannedPlaylist,
      changes: {
        addTrackUris: changes.addTrackUris,
        removeTrackUris: changes.removeTrackUris,
        ...(changes.details ? { details: changes.details } : {}),
      },
      impact: changes.impact,
      projectedTrackCount: changes.projectedTrackUris.length,
      warnings: changes.warnings,
    };
  }

  async applyPlan(planId: string) {
    const plan = this.#plans.get(planId);
    if (!plan) {
      throw new Error("Plan is unknown, expired, or already applied");
    }
    if (this.#now() > plan.expiresAt) {
      this.#plans.delete(planId);
      throw new Error("Plan has expired; create a fresh plan before writing");
    }

    this.#assertAllowlisted(plan.playlist.id);
    const [userId, current] = await Promise.all([
      this.spotify.getCurrentUserId(),
      this.spotify.getPlaylistDetails(plan.playlist.id),
    ]);
    this.#assertOwned(current, userId);
    if (current.snapshotId !== plan.playlist.snapshotId) {
      throw new Error(
        "Playlist changed since this plan was created; create a fresh plan"
      );
    }

    // Consume before the first write so a partially applied plan cannot be retried.
    this.#plans.delete(planId);
    let finalSnapshotId = current.snapshotId;
    if (plan.changes.removeTrackUris.length > 0) {
      finalSnapshotId = await this.spotify.removePlaylistItems(
        current.id,
        plan.changes.removeTrackUris,
        finalSnapshotId
      );
    }
    if (plan.changes.addTrackUris.length > 0) {
      finalSnapshotId = await this.spotify.addPlaylistItems(
        current.id,
        plan.changes.addTrackUris
      );
    }
    if (plan.changes.details) {
      await this.spotify.updatePlaylistDetails(current.id, plan.changes.details);
    }

    return {
      planId,
      playlistId: current.id,
      finalSnapshotId,
      applied: {
        addTrackUris: plan.changes.addTrackUris,
        removeTrackUris: plan.changes.removeTrackUris,
        ...(plan.changes.details ? { details: plan.changes.details } : {}),
      },
    };
  }

  #assertAllowlisted(playlistId: string): void {
    if (!this.options.allowedPlaylistIds.has(playlistId)) {
      throw new Error(`Playlist ${playlistId} is not allowlisted for writes`);
    }
  }

  #assertOwned(playlist: PlaylistDetails, userId: string): void {
    if (playlist.ownerId !== userId) {
      throw new Error(
        `Playlist ${playlist.id} is not owned by the authenticated Spotify user`
      );
    }
  }
}
