export interface Track {
    id: string;
    title: string;
    artist: string;
    youtubeId?: string | null;
    duration?: string;
}

export const tracks: Track[] = [
    {
        id: "1",
        title: "Take My Breath Away",
        artist: "Berlin",
        youtubeId: "Bx51eegLTY8",
        duration: "4:13"
    },
    {
        id: "2",
        title: "Walk This Way",
        artist: "Run-D.M.C. ft. Aerosmith",
        youtubeId: "4B_UYYPb-Gk",
        duration: "3:38"
    },
    {
        id: "3",
        title: "Livin' on a Prayer",
        artist: "Bon Jovi",
        youtubeId: "lDK9QqIzhwk",
        duration: "4:09"
    },
    {
        id: "4",
        title: "Higher Love",
        artist: "Steve Winwood",
        youtubeId: "k9olaIio3l8",
        duration: "5:36"
    },
    {
        id: "5",
        title: "Sledgehammer",
        artist: "Peter Gabriel",
        youtubeId: "g93mz_eZ5-4",
        duration: "5:41"
    }
];

export interface Playlist {
    id: string;
    name: string;
    description: string;
    trackIds: string[];
}

export const playlists: Playlist[] = [
    {
        id: "1986-hits",
        name: "1986 Top Hits",
        description: "The biggest hits of 1986",
        trackIds: ["1", "2", "3", "4", "5"]
    },
    {
        id: "trending",
        name: "Trending Now",
        description: "What's hot this week",
        trackIds: ["1", "3", "2", "5", "4"]
    }
];

/**
 * Resolves track IDs to full Track objects for a playlist.
 */
export function resolveTracks(trackIds: string[]): Track[] {
    return trackIds
        .map((id) => tracks.find((t) => t.id === id))
        .filter((t): t is Track => t !== undefined);
}
