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

export const PASTEL_SWATCHES = [
	{ name: 'Peach', value: 'var(--pastel-peach)' },
	{ name: 'Yellow', value: 'var(--pastel-yellow)' },
	{ name: 'Green', value: 'var(--pastel-green)' },
	{ name: 'Blue', value: 'var(--pastel-blue)' },
	{ name: 'Purple', value: 'var(--pastel-purple)' },
	{ name: 'Pink', value: 'var(--pastel-magenta)' }
] as const;
