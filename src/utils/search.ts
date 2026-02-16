import { TFile } from 'obsidian';
import { extractTags } from './markdown';

export interface SearchState {
	query: string;
	filterTag: string | null;
	filterPinned: 'all' | 'pinned' | 'unpinned';
	filterColors: string[];
	filterFolder: string | null;
	filterOperators: Map<string, string>;
}

export interface SearchSuggestion {
	type: 'operator' | 'tag' | 'color' | 'typeValue' | 'folder';
	value: string;
	display: string;
}

interface FuzzyResult {
	match: boolean;
	score: number;
}

// Pre-compiled regex patterns for type: operator (avoids re-creation per file)
const TYPE_PATTERNS: Record<string, RegExp> = {
	image: /!\[.*?\]\([^)]*\.(png|jpg|jpeg|gif|bmp|svg|webp)[^)]*\)|!\[\[[^\]]*\.(png|jpg|jpeg|gif|bmp|svg|webp)[^\]]*\]\]/i,
	pdf: /!?\[.*?\]\([^)]*\.pdf[^)]*\)|!?\[\[[^\]]*\.pdf[^\]]*\]\]/i,
	link: new RegExp(
		'(?<!!)\\[.*?\\]\\((?![^)]*\\.(png|jpg|jpeg|gif|bmp|svg|webp|pdf)\\b)[^)]+\\)|' +
		'(?<!!)\\[\\[(?![^\\]]*\\.(png|jpg|jpeg|gif|bmp|svg|webp|pdf)\\b)[^\\]]+\\]\\]',
		'i'
	),
	list: /^\s*[-*+]\s|^\s*\d+\.\s/m,
	code: /```[\s\S]*?```|`[^`|]+`/,
	table: /\|[^\n]*\|\n\|[\s:|-]+\|/
};

const COLOR_MAP: Record<string, string> = {
	'pink': 'pastel-magenta',
	'peach': 'pastel-peach',
	'yellow': 'pastel-yellow',
	'green': 'pastel-green',
	'blue': 'pastel-blue',
	'purple': 'pastel-purple',
	'magenta': 'pastel-magenta',
	'gray': 'pastel-gray'
};

/**
 * Fuzzy match: checks if all characters of query appear in order within target.
 * Returns a score based on match quality.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult {
	if (!query || !target) return { match: false, score: 0 };

	const lowerQuery = query.toLowerCase();
	const lowerTarget = target.toLowerCase();

	// Exact substring match gets highest score
	if (lowerTarget.includes(lowerQuery)) {
		// Bonus if match is at the start
		const idx = lowerTarget.indexOf(lowerQuery);
		const startBonus = idx === 0 ? 20 : 0;
		// Bonus for shorter targets (more relevant match)
		const lengthBonus = Math.max(0, 10 - Math.floor(target.length / 20));
		return { match: true, score: 100 + startBonus + lengthBonus };
	}

	// Fuzzy: all query chars must appear in order
	let queryIdx = 0;
	let score = 0;
	let consecutive = 0;
	let prevMatchIdx = -2;

	for (let i = 0; i < lowerTarget.length && queryIdx < lowerQuery.length; i++) {
		if (lowerTarget[i] === lowerQuery[queryIdx]) {
			queryIdx++;
			score += 1;

			// Bonus for consecutive character matches
			if (i === prevMatchIdx + 1) {
				consecutive++;
				score += consecutive * 2;
			} else {
				consecutive = 0;
			}

			// Bonus for matching at word boundaries (after space, -, _, /)
			const prevChar = i > 0 ? lowerTarget.charAt(i - 1) : '';
			if (i === 0 || /[\s\-_/]/.test(prevChar)) {
				score += 5;
			}

			prevMatchIdx = i;
		}
	}

	if (queryIdx === lowerQuery.length) {
		// Penalize if match is very spread out
		const spread = prevMatchIdx - (prevMatchIdx - queryIdx + 1);
		const spreadPenalty = Math.max(0, spread - lowerQuery.length) * 0.5;
		return { match: true, score: Math.max(1, score - spreadPenalty) };
	}

	return { match: false, score: 0 };
}

export function parseSearchOperators(query: string): Omit<SearchState, 'query'> {
	const filterOperators = new Map<string, string>();
	const filterColors: string[] = [];
	let filterTag: string | null = null;
	let filterPinned: 'all' | 'pinned' | 'unpinned' = 'all';
	let filterFolder: string | null = null;

	// Parse operators: tag:name, color:red, is:pinned, type:empty, folder:path, etc.
	// Support both quoted values (folder:"My Folder") and unquoted with spaces (folder:My Folder)
	const operatorRegex = /(tag|color|is|type|folder|path):(?:"([^"]+)"|(.+?))(?=\s+(?:tag|color|is|type|folder|path):|$)/gi;
	let match;

	while ((match = operatorRegex.exec(query)) !== null) {
		const operator = match[1]?.toLowerCase();
		// Value is either quoted (group 2) or unquoted (group 3)
		const value = (match[2] || match[3])?.trim().toLowerCase();

		if (!operator || !value) continue;

		if (operator === 'tag') {
			filterTag = value;
		} else if (operator === 'color') {
			filterColors.push(value);
		} else if (operator === 'folder' || operator === 'path') {
			filterFolder = value;
		} else if (operator === 'is') {
			if (value === 'pinned') {
				filterPinned = 'pinned';
			} else if (value === 'unpinned') {
				filterPinned = 'unpinned';
			}
		} else if (operator === 'type') {
			filterOperators.set(operator, value);
		}
	}

	return { filterTag, filterPinned, filterColors, filterFolder, filterOperators };
}

export function getSearchSuggestions(query: string, allTags: string[], allFolders: string[] = [], noteColors: Record<string, string> = {}): SearchSuggestion[] {
	const suggestions: SearchSuggestion[] = [];
	const lastWord = query.split(' ').pop() || '';

	// Show initial view when query is empty
	if (query.trim().length === 0) {
		const operators = ['folder:', 'tag:', 'color:', 'type:', 'is:pinned', 'is:unpinned'];
		operators.forEach(op => {
			suggestions.push({ type: 'operator', value: op, display: op });
		});
		return suggestions;
	}

	// Show operator suggestions
	if (!lastWord.includes(':')) {
		const operators = ['folder:', 'tag:', 'color:', 'type:', 'is:pinned', 'is:unpinned'];
		const matchingOps = operators.filter(op => op.startsWith(lastWord.toLowerCase()));

		if (matchingOps.length > 0 && lastWord.length > 0) {
			matchingOps.forEach(op => {
				suggestions.push({ type: 'operator', value: op, display: op });
			});
			return suggestions;
		}
	}

	// Show tag suggestions when typing tag:
	if (lastWord.startsWith('tag:')) {
		const tagPrefix = lastWord.substring(4).toLowerCase();
		const matchingTags = allTags.filter(tag => tag.toLowerCase().includes(tagPrefix));

		if (matchingTags.length > 0) {
			matchingTags.slice(0, 8).forEach(tag => {
				suggestions.push({ type: 'tag', value: `tag:${tag}`, display: `tag:${tag}` });
			});
			return suggestions;
		}
	}

	// Show color suggestions when typing color:
	if (lastWord.startsWith('color:')) {
		// Extract unique colors from noteColors
		const colorMap: Record<string, string> = {
			'pastel-peach': 'Peach',
			'pastel-yellow': 'Yellow',
			'pastel-green': 'Green',
			'pastel-blue': 'Blue',
			'pastel-purple': 'Purple',
			'pastel-magenta': 'Pink'
		};
		
		// Map display names to search keys
		const displayToSearchKey: Record<string, string> = {
			'Peach': 'peach',
			'Yellow': 'yellow',
			'Green': 'green',
			'Blue': 'blue',
			'Purple': 'purple',
			'Pink': 'pink'
		};
		
		const usedColors = new Set<string>();
		Object.values(noteColors).forEach(colorValue => {
			for (const [key, displayName] of Object.entries(colorMap)) {
				if (colorValue.includes(key)) {
					usedColors.add(key);
				}
			}
		});
		
		const colorPrefix = lastWord.substring(6).toLowerCase();
		const availableColors: Array<{key: string, display: string, value: string}> = [];
		
		// Add used colors
		for (const [key, displayName] of Object.entries(colorMap)) {
			if (usedColors.has(key)) {
				const searchKey = displayToSearchKey[displayName] || key.replace('pastel-', '');
				if (displayName.toLowerCase().startsWith(colorPrefix) || searchKey.startsWith(colorPrefix)) {
					availableColors.push({
						key: searchKey,
						display: displayName,
						value: `color:${searchKey}`
					});
				}
			}
		}
		
		// Add "No color" option if it matches
		if ('no color'.includes(colorPrefix) || 'gray'.startsWith(colorPrefix) || colorPrefix === '') {
			availableColors.push({
				key: 'gray',
				display: 'No color',
				value: 'color:gray'
			});
		}
		
		if (availableColors.length > 0) {
			availableColors.forEach(color => {
				suggestions.push({ type: 'color', value: color.value, display: color.display });
			});
			return suggestions;
		}
	}

	// Show type suggestions when typing type:
	if (lastWord.startsWith('type:')) {
		const types = ['empty', 'image', 'pdf', 'link', 'list', 'code', 'table'];
		const typePrefix = lastWord.substring(5).toLowerCase();
		const matchingTypes = types.filter(t => t.startsWith(typePrefix));

		if (matchingTypes.length > 0) {
			matchingTypes.forEach(type => {
				suggestions.push({ type: 'typeValue', value: `type:${type}`, display: `type:${type}` });
			});
			return suggestions;
		}
	}

	// Show folder suggestions when typing folder: or path:
	if (lastWord.startsWith('folder:') || lastWord.startsWith('path:')) {
		const prefix = lastWord.startsWith('folder:') ? 'folder:' : 'path:';
		const folderPrefix = lastWord.substring(prefix.length).toLowerCase();
		const matchingFolders = allFolders.filter(folder => folder.toLowerCase().includes(folderPrefix));

		if (matchingFolders.length > 0) {
			matchingFolders.slice(0, 8).forEach(folder => {
				const displayFolder = folder === '/' ? '/' : folder;
				suggestions.push({ type: 'folder', value: `folder:${folder}`, display: `folder:${displayFolder}` });
			});
			return suggestions;
		}
	}

	return suggestions;
}

export function getCleanQuery(query: string): string {
	return query
		.replace(/(tag|color|is|type|folder|path):(?:"[^"]+"|.+?)(?=\s+(?:tag|color|is|type|folder|path):|$)/gi, '')
		.trim()
		.toLowerCase();
}

export function isSimpleTextSearch(query: string): boolean {
	const hasOperators = /(tag|color|is|type|folder|path):/i.test(query);
	return !hasOperators && query.trim().length > 0;
}

export function highlightSearchTerms(element: HTMLElement, searchTerm: string): void {
	if (!searchTerm || searchTerm.trim().length === 0) return;
	
	const term = searchTerm.trim();
	const lowerTerm = term.toLowerCase();
	const walker = document.createTreeWalker(
		element,
		NodeFilter.SHOW_TEXT,
		null
	);
	
	const textNodes: Text[] = [];
	let node: Node | null;
	
	// Collect all text nodes
	while ((node = walker.nextNode())) {
		textNodes.push(node as Text);
	}
	
	// Process each text node — highlight ALL occurrences
	textNodes.forEach(textNode => {
		const text = textNode.textContent || '';
		const lowerText = text.toLowerCase();
		const firstIndex = lowerText.indexOf(lowerTerm);

		if (firstIndex === -1) return;

		const parent = textNode.parentNode;
		if (!parent) return;

		// Skip if already highlighted or in certain elements
		if (parent.nodeName === 'MARK' || parent.nodeName === 'CODE' || parent.nodeName === 'PRE') {
			return;
		}

		// Build fragment with all matches highlighted
		const fragment = document.createDocumentFragment();
		let lastEnd = 0;
		let searchFrom = 0;

		while (searchFrom < lowerText.length) {
			const idx = lowerText.indexOf(lowerTerm, searchFrom);
			if (idx === -1) break;

			// Add text before match
			if (idx > lastEnd) {
				fragment.appendChild(document.createTextNode(text.substring(lastEnd, idx)));
			}

			// Add highlighted match
			const mark = document.createElement('mark');
			mark.className = 'search-highlight';
			mark.textContent = text.substring(idx, idx + term.length);
			fragment.appendChild(mark);

			lastEnd = idx + term.length;
			searchFrom = lastEnd;
		}

		// Add remaining text after last match
		if (lastEnd < text.length) {
			fragment.appendChild(document.createTextNode(text.substring(lastEnd)));
		}

		parent.replaceChild(fragment, textNode);
	});
}

export function filterFiles(
	files: TFile[],
	fileContents: Map<string, string>,
	searchState: SearchState,
	isPinned: (path: string) => boolean,
	getNoteColor: (path: string) => string | undefined,
	fileTags?: Map<string, string[]>
): TFile[] {
	let filtered = [...files];

	// Apply pinned filter
	if (searchState.filterPinned === 'pinned') {
		filtered = filtered.filter(f => isPinned(f.path));
	} else if (searchState.filterPinned === 'unpinned') {
		filtered = filtered.filter(f => !isPinned(f.path));
	}

	// Apply tag filter
	if (searchState.filterTag) {
		filtered = filtered.filter(f => {
			const tags = fileTags?.get(f.path) ?? extractTags(fileContents.get(f.path) || '');
			return tags.includes(searchState.filterTag!);
		});
	}

	// Apply folder filter
	if (searchState.filterFolder) {
		const folderPath = searchState.filterFolder === '/' ? '' : searchState.filterFolder;
		filtered = filtered.filter(f => {
			if (folderPath === '') return true; // All files if root
			return f.path.toLowerCase().startsWith(folderPath);
		});
	}

	// Apply color filter
	if (searchState.filterColors.length > 0) {
		filtered = filtered.filter(f => {
			const savedColor = getNoteColor(f.path);

			const colorMatch = searchState.filterColors.some(filterColor => {
				// Special case: gray means no color
				if (filterColor === 'gray') {
					return !savedColor;
				}

				if (!savedColor) return false;

				const expectedColor = COLOR_MAP[filterColor];
				if (!expectedColor) return false;
				return savedColor.includes(expectedColor);
			});

			return colorMatch;
		});
	}

	// Apply search filter with operators and fuzzy scoring
	const cleanQuery = searchState.query ? getCleanQuery(searchState.query) : '';
	const hasTextQuery = cleanQuery.length > 0;
	const hasOperators = searchState.query && searchState.query !== cleanQuery;

	if (searchState.query) {
		// Score map for relevance ranking
		const scoreMap = new Map<string, number>();

		filtered = filtered.filter(f => {
			const content = fileContents.get(f.path) || '';
			const contentLower = content.toLowerCase();
			const tags = fileTags?.get(f.path) ?? extractTags(content);

			// Check text search with fuzzy matching
			let matchesText = true;
			let textScore = 0;

			if (hasTextQuery) {
				const titleResult = fuzzyMatch(cleanQuery, f.basename);
				const contentExact = contentLower.includes(cleanQuery);

				if (titleResult.match) {
					// Title match: base 50 + fuzzy score
					textScore = 50 + titleResult.score;
				} else if (contentExact) {
					// Content exact substring match
					textScore = 30;
				} else {
					// Try fuzzy on first 2000 chars of content for performance
					const contentSnippet = content.substring(0, 2000);
					const contentResult = fuzzyMatch(cleanQuery, contentSnippet);
					if (contentResult.match) {
						textScore = 10 + contentResult.score * 0.3;
					} else {
						matchesText = false;
					}
				}
			}

			// Check has: operators
			if (searchState.filterOperators.has('has')) {
				const hasValue = searchState.filterOperators.get('has');
				if (hasValue === 'tags' && tags.length === 0) return false;
				if (hasValue === 'content' && content.trim().length === 0) return false;
			}

			// Check type: operators using pre-compiled patterns
			if (searchState.filterOperators.has('type')) {
				const typeValue = searchState.filterOperators.get('type');

				if (typeValue === 'empty') {
					if (content.trim().length > 0) return false;
				} else if (typeValue && TYPE_PATTERNS[typeValue]) {
					if (!TYPE_PATTERNS[typeValue].test(content)) return false;
				}
			}

			if (matchesText) {
				scoreMap.set(f.path, textScore);
			}

			return matchesText;
		});

		// Sort by relevance score when there's a text query
		if (hasTextQuery) {
			filtered.sort((a, b) => {
				const scoreA = scoreMap.get(a.path) || 0;
				const scoreB = scoreMap.get(b.path) || 0;
				return scoreB - scoreA;
			});
		}
	}

	return filtered;
}
