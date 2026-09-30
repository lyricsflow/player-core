/**
 * LyricsFlow — Spicy Lyrics Animator
 * 100% Faithful Port of Spicy Lyrics Animator (LyricsAnimator.ts)
 * Features cubic spline letter springs, proximity wave falloff,
 * glowing letter shadows, and fluid line centering.
 */

import Spring from './spring.js';
import Spline from './spline.js';
import { LyricsObject } from './lyrics-applyer.js';
import { isUserScrolling } from './scroll-manager.js';
import { settingsManager } from './settings-manager.js';

// ── Spline helper ──
function getSpline(range) {
  return new Spline(range.map(r => r.Time), range.map(r => r.Value));
}

// ── Exact Spicy Lyrics Splines ──
const ScaleRange = [
  { Time: 0, Value: 0.95 },
  { Time: 0.7, Value: 1.0505 },
  { Time: 1, Value: 1 },
];

const LetterScaleRange = [
  { Time: 0, Value: 0.95 },
  { Time: 0.7, Value: 1.175 },
  { Time: 1, Value: 1 },
];

const YOffsetRange = [
  { Time: 0, Value: 1 / 100 },
  { Time: 0.9, Value: -(1 / 60) },
  { Time: 1, Value: 0 },
];

const LetterYOffsetRange = [
  { Time: 0, Value: 1 / 100 },
  { Time: 0.9, Value: -(1 / 56) },
  { Time: 1, Value: 0 },
];

const GlowRange = [
  { Time: 0, Value: 0 },
  { Time: 0.15, Value: 1 },
  { Time: 0.6, Value: 1 },
  { Time: 1, Value: 0 },
];

const LineGlowRange = [
  { Time: 0, Value: 0 },
  { Time: 0.5, Value: 1 },
  { Time: 1, Value: 0 },
];

const DotAnimations = {
  ScaleRange: [
    { Time: 0, Value: 0.75 },
    { Time: 0.7, Value: 1.05 },
    { Time: 1, Value: 1 },
  ],
  YOffsetRange: [
    { Time: 0, Value: 0 },
    { Time: 0.9, Value: -0.12 },
    { Time: 1, Value: 0 },
  ],
  GlowRange: [
    { Time: 0, Value: 0 },
    { Time: 0.6, Value: 1 },
    { Time: 1, Value: 1 },
  ],
  OpacityRange: [
    { Time: 0, Value: 0.35 },
    { Time: 0.6, Value: 1 },
    { Time: 1, Value: 1 },
  ],
};

const ScaleSpline = getSpline(ScaleRange);
const LetterScaleSpline = getSpline(LetterScaleRange);
const YOffsetSpline = getSpline(YOffsetRange);
const LetterYOffsetSpline = getSpline(LetterYOffsetRange);
const GlowSpline = getSpline(GlowRange);
const LineGlowSpline = getSpline(LineGlowRange);

const DotScaleSpline = getSpline(DotAnimations.ScaleRange);
const DotYOffsetSpline = getSpline(DotAnimations.YOffsetRange);
const DotGlowSpline = getSpline(DotAnimations.GlowRange);
const DotOpacitySpline = getSpline(DotAnimations.OpacityRange);

// ── Physical Spring Constants from Spicy Lyrics ──
const YOffsetFrequency = 1.45;
const YOffsetDamping = 0.4;
const ScaleFrequency = 0.88;
const ScaleDamping = 0.64;
const GlowFrequency = 1.18;
const GlowDamping = 0.56;

const BlurMultiplier = 2.15;
const LetterGlowMultiplier_Opacity = 185;

function easeSinOut(t) {
  return Math.sin((t * Math.PI) / 2);
}

function getElementState(currentTime, startTime, endTime) {
  if (currentTime < startTime) return "NotSung";
  if (currentTime >= endTime) return "Sung";
  return "Active";
}

function getProgressPercentage(currentTime, startTime, endTime) {
  if (currentTime <= startTime) return 0;
  if (currentTime >= endTime) return 1;
  return (currentTime - startTime) / (endTime - startTime);
}

function createWordSprings() {
  return {
    Scale: new Spring(ScaleSpline.at(0), ScaleFrequency, ScaleDamping),
    YOffset: new Spring(YOffsetSpline.at(0), YOffsetFrequency, YOffsetDamping),
    Glow: new Spring(GlowSpline.at(0), GlowFrequency, GlowDamping),
  };
}

function createLetterSprings() {
  return {
    Scale: new Spring(LetterScaleSpline.at(0), ScaleFrequency, ScaleDamping),
    YOffset: new Spring(LetterYOffsetSpline.at(0), YOffsetFrequency, YOffsetDamping),
    Glow: new Spring(GlowSpline.at(0), GlowFrequency, GlowDamping),
  };
}

function createDotSprings() {
  return {
    Scale: new Spring(DotScaleSpline.at(0), 0.7, 0.6),
    YOffset: new Spring(DotYOffsetSpline.at(0), 1.25, 0.4),
    Glow: new Spring(DotGlowSpline.at(0), 1, 0.5),
    Opacity: new Spring(DotOpacitySpline.at(0), 1, 0.5),
  };
}

function createLineSprings() {
  return {
    Glow: new Spring(LineGlowSpline.at(0), 1, 0.5),
  };
}

function promoteToGPU(el) {
  if (!el || el._gpuPromoted) return;
  el.style.willChange = "transform, opacity, text-shadow, scale";
  el.style.backfaceVisibility = "hidden";
  el._gpuPromoted = true;
}

// ── State variables ──
let lastFrameTime = performance.now();
let blurringLastLine = null;
let currentScrollTargetTop = null;
let currentScrollTop = 0;
let scrollSpring = new Spring(0, 1.2, 0.7);

function applyBlur(arr, activeIndex) {
  if (!arr[activeIndex]) return;
  const max = BlurMultiplier * 5 + BlurMultiplier * 0.465;

  for (let i = 0; i < arr.length; i++) {
    const el = arr[i].HTMLElement;
    if (!el || !el.isConnected) continue;
    const distance = Math.abs(i - activeIndex);
    const blurAmount = distance === 0 ? 0 : Math.min(BlurMultiplier * distance, max);
    const val = distance === 0 ? "0px" : `${blurAmount.toFixed(1)}px`;
    if (el._spicyLastBlur !== val) {
      el.style.setProperty("--BlurAmount", val);
      el._spicyLastBlur = val;
    }
  }
}

/**
 * Centering Smooth Scroll for Spicy Lyrics
 */
function updateSpicyScroll(activeLineElem, deltaTime) {
  if (!activeLineElem || isUserScrolling()) return;
  const container = document.getElementById("lyrics-content") || activeLineElem.closest(".LyricsContent");
  if (!container) return;

  const containerHeight = container.clientHeight;
  const lineTop = activeLineElem.offsetTop;
  const lineHeight = activeLineElem.clientHeight;

  // Center active line in container
  const targetTop = Math.max(0, lineTop - (containerHeight / 2) + (lineHeight / 2));
  scrollSpring.SetGoal(targetTop);

  const newTop = scrollSpring.Step(deltaTime);
  container.scrollTop = newTop;
}

/**
 * Main Spicy Lyrics Animation Frame
 */
export function animateSpicyLyrics(position, lyricsType = "Syllable", isHidden = false) {
  if (isHidden) return;

  const now = performance.now();
  const deltaTime = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  const lines = lyricsType === "Line"
    ? LyricsObject.Types.Line.Lines
    : LyricsObject.Types.Syllable.Lines;

  if (!lines || lines.length === 0) return;

  let activeLineIndex = -1;

  // ── Find active line ──
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (position >= line.StartTime && position <= line.EndTime) {
      activeLineIndex = i;
      break;
    }
  }

  // Fallback: if in between lines, keep current or previous line active
  if (activeLineIndex === -1) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (position >= lines[i].EndTime) {
        activeLineIndex = i;
        break;
      }
    }
  }
  if (activeLineIndex === -1 && lines.length > 0) {
    activeLineIndex = 0;
  }

  // Apply distance-based line blur
  if (blurringLastLine !== activeLineIndex && activeLineIndex !== -1) {
    applyBlur(lines, activeLineIndex);
    blurringLastLine = activeLineIndex;
  }

  // Scroll active line into center
  if (activeLineIndex !== -1 && lines[activeLineIndex]?.HTMLElement) {
    updateSpicyScroll(lines[activeLineIndex].HTMLElement, deltaTime);
  }

  // ── Syllable Mode ──
  if (lyricsType === "Syllable") {
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const el = line.HTMLElement;
      if (!el || !el.isConnected) continue;

      const lineState = getElementState(position, line.StartTime, line.EndTime);

      if (lineState === "Active") {
        if (!el.classList.contains("Active")) {
          el.classList.add("Active");
          el.classList.remove("NotSung", "Sung");
        }

        if (!line.Syllables?.Lead) continue;
        const words = line.Syllables.Lead;

        for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
          const word = words[wordIndex];
          const wordEl = word.HTMLElement;
          if (!wordEl) continue;

          const wordState = getElementState(position, word.StartTime, word.EndTime);
          const percentage = getProgressPercentage(position, word.StartTime, word.EndTime);
          const isLetterGroup = word.LetterGroup;
          const isDot = word.Dot;

          if (!isDot) {
            if (!word.AnimatorStore) {
              word.AnimatorStore = createWordSprings();
              word.AnimatorStore.Scale.SetGoal(ScaleSpline.at(0), true);
              word.AnimatorStore.YOffset.SetGoal(YOffsetSpline.at(0), true);
              word.AnimatorStore.Glow.SetGoal(GlowSpline.at(0), true);
              promoteToGPU(wordEl);
            }

            let targetScale;
            let targetYOffset;
            let targetGlow;
            let targetGradientPos;

            if (wordState === "Active") {
              targetScale = ScaleSpline.at(percentage);
              targetYOffset = YOffsetSpline.at(percentage);
              targetGlow = GlowSpline.at(percentage);
              targetGradientPos = -20 + 120 * percentage;
            } else if (wordState === "NotSung") {
              targetScale = ScaleSpline.at(0);
              targetYOffset = YOffsetSpline.at(0);
              targetGlow = GlowSpline.at(0);
              targetGradientPos = -20;
            } else {
              targetScale = ScaleSpline.at(1);
              targetYOffset = YOffsetSpline.at(1);
              targetGlow = GlowSpline.at(1);
              targetGradientPos = 100;
            }

            word.AnimatorStore.Scale.SetGoal(targetScale);
            word.AnimatorStore.YOffset.SetGoal(targetYOffset);
            word.AnimatorStore.Glow.SetGoal(targetGlow);

            const curScale = word.AnimatorStore.Scale.Step(deltaTime);
            const curYOffset = word.AnimatorStore.YOffset.Step(deltaTime);
            const curGlow = word.AnimatorStore.Glow.Step(deltaTime);

            wordEl.style.scale = curScale.toFixed(4);
            wordEl.style.transform = `translate3d(0, calc(var(--DefaultLyricsSize, 2.5rem) * ${curYOffset.toFixed(4)}), 0)`;

            if (!isLetterGroup) {
              wordEl.style.setProperty("--gradient-position", `${targetGradientPos.toFixed(1)}%`);
              wordEl.style.setProperty("--text-shadow-blur-radius", `${(4 + 2 * curGlow).toFixed(1)}px`);
              wordEl.style.setProperty("--text-shadow-opacity", `${Math.min(curGlow * 35, 100).toFixed(1)}%`);
            }
          } else {
            // Dot animation
            if (!word.AnimatorStore) {
              word.AnimatorStore = createDotSprings();
              word.AnimatorStore.Scale.SetGoal(DotScaleSpline.at(0), true);
              word.AnimatorStore.YOffset.SetGoal(DotYOffsetSpline.at(0), true);
              word.AnimatorStore.Glow.SetGoal(DotGlowSpline.at(0), true);
              word.AnimatorStore.Opacity.SetGoal(DotOpacitySpline.at(0), true);
              promoteToGPU(wordEl);
            }

            let targetScale, targetYOffset, targetGlow, targetOpacity;
            if (wordState === "Active") {
              targetScale = DotScaleSpline.at(percentage);
              targetYOffset = DotYOffsetSpline.at(percentage);
              targetGlow = DotGlowSpline.at(percentage);
              targetOpacity = DotOpacitySpline.at(percentage);
            } else if (wordState === "NotSung") {
              targetScale = DotScaleSpline.at(0);
              targetYOffset = DotYOffsetSpline.at(0);
              targetGlow = DotGlowSpline.at(0);
              targetOpacity = DotOpacitySpline.at(0);
            } else {
              targetScale = DotScaleSpline.at(1);
              targetYOffset = DotYOffsetSpline.at(1);
              targetGlow = DotGlowSpline.at(1);
              targetOpacity = DotOpacitySpline.at(1);
            }

            word.AnimatorStore.Scale.SetGoal(targetScale);
            word.AnimatorStore.YOffset.SetGoal(targetYOffset);
            word.AnimatorStore.Glow.SetGoal(targetGlow);
            word.AnimatorStore.Opacity.SetGoal(targetOpacity);

            const curScale = word.AnimatorStore.Scale.Step(deltaTime);
            const curYOffset = word.AnimatorStore.YOffset.Step(deltaTime);
            const curGlow = word.AnimatorStore.Glow.Step(deltaTime);
            const curOpacity = word.AnimatorStore.Opacity.Step(deltaTime);

            wordEl.style.transform = `translate3d(0, calc(var(--DefaultLyricsSize, 2.5rem) * ${curYOffset.toFixed(4)}), 0)`;
            wordEl.style.scale = curScale.toFixed(4);
            wordEl.style.opacity = curOpacity.toFixed(3);
            wordEl.style.setProperty("--text-shadow-blur-radius", `${(4 + 6 * curGlow).toFixed(1)}px`);
            wordEl.style.setProperty("--text-shadow-opacity", `${(curGlow * 90).toFixed(1)}%`);
          }

          // ── Proximity Spring Wave for Letter Groups ──
          if (isLetterGroup && word.Letters) {
            let activeLetterIndex = -1;
            let activeLetterPercentage = 0;

            if (wordState === "Active") {
              for (let i = 0; i < word.Letters.length; i++) {
                if (getElementState(position, word.Letters[i].StartTime, word.Letters[i].EndTime) === "Active") {
                  activeLetterIndex = i;
                  activeLetterPercentage = getProgressPercentage(position, word.Letters[i].StartTime, word.Letters[i].EndTime);
                  break;
                }
              }
            }

            for (let k = 0; k < word.Letters.length; k++) {
              const letter = word.Letters[k];
              const letterEl = letter.HTMLElement;
              if (!letterEl) continue;

              if (!letter.AnimatorStore) {
                letter.AnimatorStore = createLetterSprings();
                letter.AnimatorStore.Scale.SetGoal(LetterScaleSpline.at(0), true);
                letter.AnimatorStore.YOffset.SetGoal(LetterYOffsetSpline.at(0), true);
                letter.AnimatorStore.Glow.SetGoal(GlowSpline.at(0), true);
                promoteToGPU(letterEl);
              }

              const letterState = getElementState(position, letter.StartTime, letter.EndTime);
              let targetScale = LetterScaleSpline.at(0);
              let targetYOffset = LetterYOffsetSpline.at(0);
              let targetGlow = GlowSpline.at(0);
              let targetGradient = -20;

              if (wordState === "Active" && activeLetterIndex !== -1) {
                const baseScale = LetterScaleSpline.at(activeLetterPercentage);
                const baseYOffset = LetterYOffsetSpline.at(activeLetterPercentage);
                const baseGlow = GlowSpline.at(activeLetterPercentage);

                const restingScale = LetterScaleSpline.at(0);
                const restingYOffset = LetterYOffsetSpline.at(0);
                const restingGlow = GlowSpline.at(0);

                const distance = Math.abs(k - activeLetterIndex);
                // Iconic Spicy steep proximity falloff
                const falloff = Math.max(0, 1 / (1 + Math.pow(distance, 2.8)));
                const glowFalloff = Math.max(0, 1 / (1 + distance * 0.9));

                targetScale = restingScale + (baseScale - restingScale) * falloff;
                targetYOffset = restingYOffset + (baseYOffset - restingYOffset) * falloff;
                targetGlow = restingGlow + (baseGlow - restingGlow) * glowFalloff;

                targetGradient = k === activeLetterIndex
                  ? -20 + 120 * easeSinOut(activeLetterPercentage)
                  : -20;
              } else if (letterState === "Sung" || wordState === "Sung") {
                targetScale = LetterScaleSpline.at(1);
                targetYOffset = LetterYOffsetSpline.at(1);
                targetGlow = GlowSpline.at(1);
                targetGradient = 100;
              }

              letter.AnimatorStore.Scale.SetGoal(targetScale);
              letter.AnimatorStore.YOffset.SetGoal(targetYOffset);
              letter.AnimatorStore.Glow.SetGoal(targetGlow);

              const curScale = letter.AnimatorStore.Scale.Step(deltaTime);
              const curYOffset = letter.AnimatorStore.YOffset.Step(deltaTime);
              const curGlow = letter.AnimatorStore.Glow.Step(deltaTime);

              letterEl.style.setProperty("--gradient-position", `${targetGradient.toFixed(1)}%`);
              letterEl.style.transform = `translate3d(0, calc(var(--DefaultLyricsSize, 2.5rem) * ${(curYOffset * 2).toFixed(4)}), 0)`;
              letterEl.style.scale = curScale.toFixed(4);
              letterEl.style.setProperty("--text-shadow-blur-radius", `${(4 + 12 * curGlow).toFixed(1)}px`);
              letterEl.style.setProperty("--text-shadow-opacity", `${(curGlow * LetterGlowMultiplier_Opacity).toFixed(1)}%`);
            }
          }
        }
      } else if (lineState === "NotSung") {
        if (!el.classList.contains("NotSung")) {
          el.classList.add("NotSung");
          el.classList.remove("Active", "Sung");
        }
      } else if (lineState === "Sung") {
        if (!el.classList.contains("Sung")) {
          el.classList.add("Sung");
          el.classList.remove("Active", "NotSung");
        }
      }
    }
  } else if (lyricsType === "Line") {
    // ── Line-Synced Mode ──
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const el = line.HTMLElement;
      if (!el || !el.isConnected) continue;

      const lineState = getElementState(position, line.StartTime, line.EndTime);
      const percentage = getProgressPercentage(position, line.StartTime, line.EndTime);

      if (lineState === "Active") {
        if (!el.classList.contains("Active")) {
          el.classList.add("Active");
          el.classList.remove("NotSung", "Sung");
        }

        if (!line.AnimatorStore) {
          line.AnimatorStore = createLineSprings();
          line.AnimatorStore.Glow.SetGoal(LineGlowSpline.at(0), true);
        }

        line.AnimatorStore.Glow.SetGoal(LineGlowSpline.at(percentage));
        const curGlow = line.AnimatorStore.Glow.Step(deltaTime);

        el.style.setProperty("--gradient-position", `${(percentage * 100).toFixed(1)}%`);
        el.style.setProperty("--text-shadow-blur-radius", `${(4 + 8 * curGlow).toFixed(1)}px`);
        el.style.setProperty("--text-shadow-opacity", `${(curGlow * 50).toFixed(1)}%`);
      } else if (lineState === "NotSung") {
        if (!el.classList.contains("NotSung")) {
          el.classList.add("NotSung");
          el.classList.remove("Active", "Sung");
        }
      } else if (lineState === "Sung") {
        if (!el.classList.contains("Sung")) {
          el.classList.add("Sung");
          el.classList.remove("Active", "NotSung");
        }
        el.style.setProperty("--gradient-position", "100%");
      }
    }
  }
}

export function resetSpicyLyrics() {
  blurringLastLine = null;
  lastFrameTime = performance.now();
}
