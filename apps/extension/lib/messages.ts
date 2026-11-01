/** Runtime messages between extension parts (content script ↔ background). Not part of the frame wire protocol. */
export const LOAD_CAPTURE = 'fc-load-capture';
/** Bridge → background: inject the discovery helper (discover.js) into this frame's MAIN world, once. */
export const LOAD_DISCOVER = 'fc-load-discover';
