export const FILE_FETCH_MULTIPLIER = 3;

export const DEBOUNCE_REFRESH_MS = 1000;
export const DEBOUNCE_SEARCH_MS = 200;
export const MAX_PREVIEW_LENGTH = 800;

/**
 * Maximum height for dashboard cards in pixels.
 * Prevents excessively tall cards from disrupting the masonry layout.
 */
export const MAX_CARD_HEIGHT = 600;

export const CARD_SIZE = {
	XL: 800,
	LARGE: 500,
	MEDIUM: 250,
	SMALL: 100,
	XS: 0
} as const;
