<div align="center">

![Lyricsflow Banner](images/banner.png)

**A high-fidelity web music player with word-by-word synced lyrics, dynamic animated artwork backgrounds, and the AeroUI glassmorphism design system.**

[![License](https://img.shields.io/badge/License-AGPL--3.0-blue)](LICENSE)
[![Maintained](https://img.shields.io/badge/Maintained-Yes-brightgreen)](https://github.com/)

</div>

---

## 🎵 What is Lyricsflow?

Lyricsflow is a fast, web-based music player designed for beautiful synchronized lyrics experiences with fluid animations, dynamic canvas backgrounds, and syllable-level glow and scale effects.

> **Note:** Lyricsflow is based on and incorporates bits from [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics). It **does not use AMLL** (Apple Music Lyrics Library) — all playback, synchronization, TTML/LRC parsing, and lyrics rendering are handled independently via custom lightweight web engines.

<div align="center">

<img src="images/preview.gif" width="90%" style="border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);" alt="Lyricsflow Preview">

</div>

---

## ✨ Features

### 🎨 Visuals & Design
- **AeroUI Design System**: Sleek Apple-style frosted glassmorphism, spring physics, tactile buttons, squish sliders, and fluid modals.
- **Dynamic Backgrounds**: Real-time canvas mesh and palette gradients generated from album artwork.
- **Animated Artwork**: Support for animated album covers and video motion backgrounds.

### 🎤 Synchronized Lyrics
- **Word-by-Word Sync**: Syllable-level tracking, glow, and spring scale effects as lyrics are sung.
- **Multi-Format Support**: Native `.ttml` (Rich TTML), `.lrc`, and plain text lyrics.
- **Multi-Source Fetching**: Seamless fallback across Musixmatch, Genius, LRCLIB, Netease, and the Lyricsflow Community database.
- **Offset Calibration**: Live millisecond synchronization slider to fine-tune lyrics timing.

### 🎧 Audio & Controls
- **Catalog Search & Local Uploads**: Search tracks, albums, and playlists or drag-and-drop local MP3/M4A/FLAC files.
- **Graphic Equalizer**: Built-in 10-band equalizer with Apple-style sound presets (Bass Boost, Vocal, Acoustic, Electronic, etc.).
- **Extensions**: Custom plugin engine allowing modular extensions with sandboxing and permissions.

---

## 🚀 Getting Started

No build tools or installations required — Lyricsflow runs directly in any modern web browser.

1. Visit [spicyamll.online](https://spicyamll.online).
2. Search for any song/artist or drop your local audio files.
3. Enjoy high-fidelity playback with synchronized lyrics and dynamic artwork.

---

## 🤝 Credits & Acknowledgements

- **[Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics)** — Foundation and concepts that inspired parts of this project.
- **[AeroUI](https://nurislamaibekuly.github.io/aeroui/)** — Beautiful glassmorphic UI components and spring motion design.
- **Apple Developer Fonts** — San Francisco Pro typography (all rights reserved by Apple Inc.).
- Thanks to all contributors, testers, and the open-source community!

---

## 📄 License

Licensed under the **GNU Affero General Public License v3.0**. See the [LICENSE](LICENSE) file for details.
