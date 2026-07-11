// Dispatched on `window` once the homepage hero background (video or fallback image) has
// actually painted a frame, so the boot splash in index.html/main.tsx can wait for it.
export const HERO_READY_EVENT = "bite:hero-ready";
