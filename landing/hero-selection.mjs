// Persist the NEXT scene, using stable names so stored values are unambiguous.
export const HERO_VARIANTS = Object.freeze(['clouds', 'glyphs', 'ribbons', 'voids']);
export const HERO_STORAGE_KEY = 'loginom-dock.hero.next-variant.v1';

export function selectNextVariant(storage) {
  let index = 0;
  try {
    const stored = storage?.getItem(HERO_STORAGE_KEY);
    const savedIndex = HERO_VARIANTS.indexOf(stored);
    if (savedIndex >= 0) index = savedIndex;
  } catch { /* Storage can be disabled without disabling the landing. */ }
  try {
    storage?.setItem(HERO_STORAGE_KEY, HERO_VARIANTS[(index + 1) % HERO_VARIANTS.length]);
  } catch { /* Render the selected scene even when persistence is unavailable. */ }
  return HERO_VARIANTS[index];
}
