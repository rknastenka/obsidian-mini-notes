/**
 * JS-driven masonry layout for `.mini-notes-grid-section`.
 *
 * CSS multi-column layout balances column *height*, not column *count* — with
 * a tall card or few items, the browser will happily use fewer columns than
 * `column-count` allows (this is why pinned sections, which usually have
 * fewer/taller cards, looked capped well below the unpinned section's column
 * count). This module replaces that with an explicit shortest-column-first
 * placement so column count only ever depends on available width and the
 * number of cards, never on content height.
 *
 * Cards are positioned with `position: absolute` inside their section, which
 * keeps DOM sibling order (used for drag-and-drop reordering and persisted
 * note order) completely independent of visual column placement.
 */

export const MASONRY_GAP = 12;

const BREAKPOINTS: { minWidth: number; columns: number }[] = [
	{ minWidth: 1400, columns: 6 },
	{ minWidth: 1100, columns: 5 },
	{ minWidth: 800, columns: 4 },
	{ minWidth: 500, columns: 3 },
	{ minWidth: 300, columns: 2 },
	{ minWidth: 0, columns: 1 },
];

export function getColumnCount(containerWidth: number): number {
	for (const bp of BREAKPOINTS) {
		if (containerWidth >= bp.minWidth) return bp.columns;
	}
	return 1;
}

/**
 * Lays out the `.dashboard-card` children of `section` into shortest-column-first
 * masonry columns. Card heights are cached per-element since re-measuring forces
 * a synchronous layout; the cache is invalidated automatically whenever the
 * computed column width changes (text can reflow to a different height), and
 * callers should delete an entry (e.g. on image load) when a card's content changes.
 */
export function layoutMasonrySection(section: HTMLElement, heightCache: WeakMap<HTMLElement, number>, gap = MASONRY_GAP): void {
	const cards = Array.from(section.children).filter(
		(el): el is HTMLElement => el.classList.contains('dashboard-card')
	);

	if (cards.length === 0) {
		section.setCssStyles({ height: '0px' });
		return;
	}

	const containerWidth = section.clientWidth;
	const columnCount = getColumnCount(containerWidth);
	const colWidth = (containerWidth - gap * (columnCount - 1)) / columnCount;

	// Column width affects text wrapping/content height, so a width change
	// invalidates every cached height.
	const widthKey = Math.round(colWidth).toString();
	if (section.getAttribute('data-masonry-col-width') !== widthKey) {
		section.setAttribute('data-masonry-col-width', widthKey);
		for (const card of cards) heightCache.delete(card);
	}

	// Batch layout writes, then reads, then writes again. Interleaving a size
	// read after positioning every card can force a full synchronous layout per card.
	for (const card of cards) {
		card.setCssStyles({ width: `${colWidth}px` });
	}

	const cardHeights = cards.map(card => {
		let height = heightCache.get(card);
		if (height === undefined) {
			height = card.getBoundingClientRect().height;
			heightCache.set(card, height);
		}
		return height;
	});

	const columnHeights: number[] = new Array<number>(columnCount).fill(0);

	for (let cardIndex = 0; cardIndex < cards.length; cardIndex++) {
		const card = cards[cardIndex]!;
		let target = 0;
		let shortest = columnHeights[0] ?? 0;
		for (let i = 1; i < columnCount; i++) {
			const height = columnHeights[i] ?? 0;
			if (height < shortest) {
				shortest = height;
				target = i;
			}
		}

		const top = shortest;
		card.setCssStyles({
			left: `${target * (colWidth + gap)}px`,
			top: `${top}px`,
		});

		columnHeights[target] = top + cardHeights[cardIndex]! + gap;
	}

	section.setCssStyles({ height: `${Math.max(...columnHeights) - gap}px` });
}
