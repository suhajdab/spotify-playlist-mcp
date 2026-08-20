import type {
  PlaylistChangeRequest,
  PlaylistDetailUpdate,
} from "./types.js";

const TRACK_URI_PATTERN = /^spotify:track:([A-Za-z0-9]{22})$/;
const TRACK_URL_PATTERN =
  /^https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]{22})(?:[/?#].*)?$/;

export interface PlaylistChangeSet {
  addTrackUris: string[];
  removeTrackUris: string[];
  details?: PlaylistDetailUpdate;
  projectedTrackUris: string[];
  impact: {
    additions: number;
    removalOccurrences: number;
    detailFields: number;
    totalTrackChanges: number;
  };
  warnings: string[];
}
export function normalizeSpotifyTrackUri(value: string): string {
  const trimmed = value.trim();
  const uriMatch = TRACK_URI_PATTERN.exec(trimmed);
  if (uriMatch) return `spotify:track:${uriMatch[1]}`;

  const urlMatch = TRACK_URL_PATTERN.exec(trimmed);
  if (urlMatch) return `spotify:track:${urlMatch[1]}`;

  throw new Error(`Expected a Spotify track URI or URL, received: ${value}`);
}

function uniqueNormalized(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map(normalizeSpotifyTrackUri))];
}

function validateDetails(
  details: PlaylistDetailUpdate | undefined
): PlaylistDetailUpdate | undefined {
  if (!details) return undefined;

  const validated: PlaylistDetailUpdate = {};
  if (details.name !== undefined) {
    const name = details.name.trim();
    if (name.length === 0 || name.length > 100) {
      throw new Error("Playlist name must contain 1 to 100 characters");
    }
    validated.name = name;
  }
  if (details.description !== undefined) {
    if (details.description.length > 300) {
      throw new Error("Playlist description must not exceed 300 characters");
    }
    validated.description = details.description;
  }
  if (details.public !== undefined) validated.public = details.public;

  return Object.keys(validated).length > 0 ? validated : undefined;
}

export function buildPlaylistChangeSet(
  currentTrackUris: string[],
  request: Omit<PlaylistChangeRequest, "playlistId">,
  maxChanges: number
): PlaylistChangeSet {
  const current = currentTrackUris.map(normalizeSpotifyTrackUri);
  const requestedAdditions = uniqueNormalized(request.addTrackUris);
  const requestedRemovals = uniqueNormalized(request.removeTrackUris);
  const requestedAdditionSet = new Set(requestedAdditions);

  const ambiguous = requestedRemovals.find((uri) => requestedAdditionSet.has(uri));
  if (ambiguous) {
    throw new Error(`${ambiguous} cannot be both added and removed in one plan`);
  }

  const currentSet = new Set(current);
  const warnings: string[] = [];
  const addTrackUris = requestedAdditions.filter((uri) => {
    if (!currentSet.has(uri)) return true;
    warnings.push(`${uri} is already in the playlist; addition skipped`);
    return false;
  });
  const removeTrackUris = requestedRemovals.filter((uri) => {
    if (currentSet.has(uri)) return true;
    warnings.push(`${uri} is not in the playlist; removal skipped`);
    return false;
  });

  const removalSet = new Set(removeTrackUris);
  const removalOccurrences = current.filter((uri) => removalSet.has(uri)).length;
  const totalTrackChanges = removalOccurrences + addTrackUris.length;
  if (totalTrackChanges > maxChanges) {
    throw new Error(
      `Plan would make ${totalTrackChanges} track changes; maximum of ${maxChanges} track changes is allowed`
    );
  }

  const details = validateDetails(request.details);
  const projectedTrackUris = current
    .filter((uri) => !removalSet.has(uri))
    .concat(addTrackUris);

  return {
    addTrackUris,
    removeTrackUris,
    ...(details ? { details } : {}),
    projectedTrackUris,
    impact: {
      additions: addTrackUris.length,
      removalOccurrences,
      detailFields: details ? Object.keys(details).length : 0,
      totalTrackChanges,
    },
    warnings,
  };
}
