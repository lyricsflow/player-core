/**
 * LyricsFlow — Apple Music Style Multi-Shelf Recommendation Engine
 * Fetches Editorial Playlists, Stations, Heavy Rotation, and Categorized Shelves.
 */

const API_BASE = "https://api.trylyricsflow.com";
const DEFAULT_STOREFRONT = "us";

function cleanArtUrl(url, w = 600, h = 600) {
  if (!url || typeof url !== 'string') return 'favicon.svg';
  let cleaned = url
    .replace('{w}', String(w))
    .replace('{h}', String(h))
    .replace('{c}', '')
    .replace('{f}', 'jpg');
  if (w > 100 && /\/\d+x\d+bb\./.test(cleaned)) {
    cleaned = cleaned.replace(/\/\d+x\d+bb\./, `/${w}x${h}bb.`);
  }
  return /^https?:\/\//i.test(cleaned) ? cleaned : 'favicon.svg';
}

export function getListeningHistory() {
  try {
    const raw = localStorage.getItem('lyricsflow_recent_tracks');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('[Algorithm] Failed to parse recent tracks:', e);
    return [];
  }
}

export function hasListenedSongs() {
  return getListeningHistory().length > 0;
}

/**
 * Returns up to 10 recently played songs (latest to oldest)
 */
export function getRecentlyPlayed10() {
  const history = getListeningHistory();
  return history.slice(0, 10).map(t => ({
    id: t.trackId || t.id || t.amTrackId,
    title: t.trackName || t.name || t.title || 'Song',
    artist: t.artistName || t.artist || 'Unknown Artist',
    album: t.collectionName || t.album || '',
    artUrl: (t.artworkUrl100 || t.artUrl || 'favicon.svg').replace('100x100', '600x600'),
    raw: t
  }));
}

/**
 * 1. "Top Picks for You" / "Playlists Made for You" Shelf
 * Fetches Apple Music browse recommendations and editorial groupings.
 */
export async function generateTopPicks(storefront = DEFAULT_STOREFRONT) {
  try {
    const res = await fetch(`${API_BASE}/v1/catalog/${storefront}/recommendations?name=search-landing`);
    if (!res.ok) return [];
    const data = await res.json();
    
    const rawResults = data.results || {};
    const items = [];

    Object.keys(rawResults).forEach(key => {
      const group = rawResults[key];
      (group.data || []).forEach(item => {
        const attr = item.attributes || {};
        items.push({
          type: item.type || 'playlist',
          id: item.id,
          title: attr.name || 'Curated Mix',
          subtitle: attr.curatorName || attr.description || 'Apple Music',
          artUrl: cleanArtUrl(attr.artwork?.url, 600, 600),
          raw: item
        });
      });
    });

    return items.slice(0, 10);
  } catch (e) {
    console.error('[Algorithm] Failed to fetch top picks shelves:', e);
    return [];
  }
}

/**
 * 2. "Stations for You" Shelf
 * Generates artist-driven and discovery station blocks based on listening history.
 */
export async function generateStationsForYou(storefront = DEFAULT_STOREFRONT) {
  const history = getListeningHistory();
  const artistNames = [...new Set(history.map(t => t.artistName || t.artist).filter(Boolean))];
  const targetArtists = artistNames.slice(0, 5);

  if (targetArtists.length === 0) {
    targetArtists.push('Hits', 'Pop', 'Discovery');
  }

  const stations = [];

  try {
    const promises = targetArtists.map(async (artName) => {
      const res = await fetch(`${API_BASE}/v1/catalog/${storefront}/search?term=${encodeURIComponent(artName)}&types=stations,artists&limit=3`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.results || {};
    });

    const results = (await Promise.all(promises)).filter(Boolean);

    results.forEach(res => {
      (res.stations?.data || []).forEach(station => {
        const attr = station.attributes || {};
        stations.push({
          type: 'station',
          id: station.id,
          title: attr.name || 'Station',
          subtitle: attr.editorialNotes?.standard || 'Custom Radio Station',
          artUrl: cleanArtUrl(attr.artwork?.url, 600, 600),
          raw: station
        });
      });
    });
  } catch (e) {
    console.error('[Algorithm] Error building stations shelf:', e);
  }

  return stations;
}

/**
 * 3. Categorized Era / Genre Shelves (e.g., "2000s", "More Like Yeezus")
 */
export async function generateCategoryShelf(query, storefront = DEFAULT_STOREFRONT, limit = 10) {
  try {
    const res = await fetch(`${API_BASE}/v1/catalog/${storefront}/search?term=${encodeURIComponent(query)}&types=albums,songs,playlists&limit=${limit}`);
    if (!res.ok) return [];
    const data = await res.json();
    const results = data.results || {};
    
    const shelfItems = [];
    const pool = [...(results.albums?.data || []), ...(results.playlists?.data || [])];
    
    pool.forEach(item => {
      const attr = item.attributes || {};
      shelfItems.push({
        type: item.type,
        id: item.id,
        title: attr.name || query,
        subtitle: attr.artistName || attr.curatorName || '',
        artUrl: cleanArtUrl(attr.artwork?.url, 600, 600),
        raw: item
      });
    });

    return shelfItems;
  } catch (e) {
    console.error(`[Algorithm] Failed shelf generation for query: ${query}`, e);
    return [];
  }
}

/**
 * 4. Full 90 Recommendation Batch (Heavy Rotation & Discovery Mix)
 */
export async function generate90Recommendations(storefront = DEFAULT_STOREFRONT) {
  const history = getListeningHistory();
  const listenedIds = new Set(history.map(t => String(t.trackId || t.id || t.amTrackId)));
  const artistNames = [...new Set(history.map(t => t.artistName || t.artist).filter(Boolean))];
  const queries = artistNames.slice(0, 6);
  if (queries.length === 0) queries.push('Top Hits', 'R&B', 'Hip-Hop', 'Pop');

  const allItems = [];

  try {
    const searchPromises = queries.map(q => 
      fetch(`${API_BASE}/v1/catalog/${storefront}/search?term=${encodeURIComponent(q)}&types=songs,albums&limit=25`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    );

    const chartsPromise = fetch(`${API_BASE}/v1/catalog/${storefront}/charts`)
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);

    const [charts, ...searchRes] = await Promise.all([chartsPromise, ...searchPromises]);

    searchRes.filter(Boolean).forEach(data => {
      const res = data.results || {};
      (res.songs?.data || []).forEach(s => {
        if (!listenedIds.has(String(s.id))) {
          const attr = s.attributes || {};
          allItems.push({
            type: 'song',
            id: s.id,
            title: attr.name || 'Song',
            subtitle: attr.artistName || 'Artist',
            album: attr.albumName || '',
            artUrl: cleanArtUrl(attr.artwork?.url, 600, 600),
            raw: s
          });
        }
      });
    });

    if (charts && charts.results?.songs) {
      charts.results.songs.forEach(group => {
        (group.data || []).forEach(s => {
          if (!listenedIds.has(String(s.id))) {
            const attr = s.attributes || {};
            allItems.push({
              type: 'song',
              id: s.id,
              title: attr.name || 'Chart Song',
              subtitle: attr.artistName || 'Artist',
              artUrl: cleanArtUrl(attr.artwork?.url, 600, 600),
              raw: s
            });
          }
        });
      });
    }

    const seen = new Set();
    const finalRecommendations = [];
    const shuffled = allItems.sort(() => 0.5 - Math.random());

    for (const item of shuffled) {
      if (!seen.has(String(item.id))) {
        seen.add(String(item.id));
        finalRecommendations.push(item);
        if (finalRecommendations.length >= 90) break;
      }
    }

    return finalRecommendations;
  } catch (e) {
    console.error('[Algorithm] Failed 90 recommendations generation:', e);
    return [];
  }
}