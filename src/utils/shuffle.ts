export function shuffleInPlace<T>(items: T[], random: () => number = Math.random): T[] {
	for (let index = items.length - 1; index > 0; index--) {
		const swapIndex = Math.floor(random() * (index + 1));
		const currentItem = items[index];
		items[index] = items[swapIndex]!;
		items[swapIndex] = currentItem!;
	}

	return items;
}
