export type PlaceBloggerCandidate = {
  blogId: string;
  nick?: string;
  title?: string;
  fromPlaces: string[];
};

function placeCandidatesKey(userId?: string): string {
  return `publy_place_blogger_candidates_v1_${userId || "local"}`;
}

export function savePlaceBloggerCandidates(candidates: PlaceBloggerCandidate[], userId?: string): void {
  localStorage.setItem(placeCandidatesKey(userId), JSON.stringify(candidates));
}

export function takePlaceBloggerCandidates(userId?: string): PlaceBloggerCandidate[] {
  try {
    const key = placeCandidatesKey(userId);
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    localStorage.removeItem(key);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PlaceBloggerCandidate =>
      !!item && typeof item.blogId === "string" && item.blogId.trim().length > 0
    );
  } catch {
    return [];
  }
}
