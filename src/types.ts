export interface PlaylistDetails {
  id: string;
  name: string;
  description: string;
  isPublic: boolean | null;
  ownerId: string;
  snapshotId: string;
  itemCount: number;
}
export interface PlaylistItem {
  uri: string;
  name: string;
  artists: string[];
  album: string;
  addedAt: string | null;
}

export interface OwnedPlaylistSummary {
  id: string;
  name: string;
  description: string;
  isPublic: boolean | null;
  snapshotId: string;
  itemCount: number;
  spotifyUrl: string;
}

export interface TrackSearchResult {
  uri: string;
  name: string;
  artists: string[];
  album: string;
  spotifyUrl: string;
}

export interface PlaylistDetailUpdate {
  name?: string;
  description?: string;
  public?: boolean;
}

export interface PlaylistChangeRequest {
  playlistId: string;
  addTrackUris?: string[];
  removeTrackUris?: string[];
  details?: PlaylistDetailUpdate;
}

export interface SpotifyGateway {
  getCurrentUserId(): Promise<string>;
  getPlaylistDetails(playlistId: string): Promise<PlaylistDetails>;
  getPlaylistItems(playlistId: string): Promise<PlaylistItem[]>;
  removePlaylistItems(
    playlistId: string,
    uris: string[],
    snapshotId: string
  ): Promise<string>;
  addPlaylistItems(playlistId: string, uris: string[]): Promise<string>;
  updatePlaylistDetails(
    playlistId: string,
    details: PlaylistDetailUpdate
  ): Promise<void>;
}
