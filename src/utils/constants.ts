export const FILE_FETCH_MULTIPLIER = 3;

export const DEBOUNCE_REFRESH_MS = 1000;
export const MAX_PREVIEW_LENGTH = 800;

export const MAX_CARD_HEIGHT = 600;

export const CARD_SIZE = {
	XL: 800,
	LARGE: 500,
	MEDIUM: 250,
	SMALL: 100,
	XS: 0
} as const;

export const PREVIEW_LENGTH_CONFIG = {
	short: { maxChars: 200, maxCardHeight: 200, lineClamp: 5 },
	medium: { maxChars: 500, maxCardHeight: 400, lineClamp: 10 },
	long: { maxChars: 800, maxCardHeight: 600, lineClamp: 15 },
} as const;
