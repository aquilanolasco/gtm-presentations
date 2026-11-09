// Internal link 1: /presentations/<deck-slug> renders the Presentations module deep-linked to that
// deck (left menu + right-pane preview). The module reads the deck slug from the path on load.
// (Fullscreen "presentation mode" lives at /presentations/p/<slug>, served by nginx, not Next.)
export { default } from "../page";
