import { showToast } from './toast.js';
import { GetExpireStore } from './stores.js';

export const LyricsStore = GetExpireStore("SL:lyrics", 1, { Duration: 3, Unit: "Days" });

export const RemoveCurrentLyrics_AllCaches = async (ui = false) => {
  const nowBar = document.getElementById('now-bar');
  const songId = nowBar?.getAttribute('data-am-track-id');
  const songName = document.querySelector('.SongName span')?.textContent || '';
  const artistName = document.querySelector('.Artists')?.textContent || '';
  const cacheKey = songId || `${songName}_${artistName}`.toLowerCase().replace(/\s+/g, '_');

  try {
    await LyricsStore.RemoveItem(cacheKey);
    if (ui) {
      showToast({ message: `Lyrics for "${songName}" removed from persistent caches.` });
    }
  } catch (error) {
    if (ui) {
      showToast({ message: `Failed to remove lyrics cache.` });
    }
    console.error("Lyricsflow Cache:", error);
  }
};

export const RemoveLyricsCache = async (ui = false) => {
  try {
    await LyricsStore.Destroy();
    if (ui) {
      showToast({ message: "Lyrics cache destroyed successfully." });
    }
  } catch (error) {
    if (ui) {
      showToast({ message: `Failed to destroy Lyrics Cache.` });
    }
    console.error("Lyricsflow Cache:", error);
  }
};

export const RemoveCurrentLyrics_StateCache = (ui = false) => {
  try {
    if (ui) {
      showToast({ message: "Lyrics cleared from internal state." });
    }
  } catch (error) {
    console.error("Lyricsflow State:", error);
  }
};
