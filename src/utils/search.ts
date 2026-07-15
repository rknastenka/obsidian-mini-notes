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
		for (const path of Object.keys(noteColors)) {
			const colorValue = noteColors[path];
			if (!colorValue) continue;

			for (const key of Object.keys(colorMap)) {
				if (colorValue.includes(key)) {
					usedColors.add(key);
				}
			}
		}

		const colorPrefix = lastWord.substring(6).toLowerCase();
		const availableColors: Array<{key: string, display: string, value: string}> = [];

		// Add used colors
		for (const key of Object.keys(colorMap)) {
			if (usedColors.has(key)) {
				const displayName = colorMap[key] ?? key;
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
	const walker = activeDocument.createTreeWalker(
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
	
	// Process each text node
	textNodes.forEach(textNode => {
		const text = textNode.textContent || '';
		const lowerText = text.toLowerCase();
		const lowerTerm = term.toLowerCase();
		const index = lowerText.indexOf(lowerTerm);
		
		if (index !== -1) {
			const parent = textNode.parentNode;
			if (!parent) return;
			
			// Skip if already highlighted or in certain elements
			if (parent.nodeName === 'MARK' || parent.nodeName === 'CODE' || parent.nodeName === 'PRE') {
				return;
			}
			
			// Create highlighted version
			const before = text.substring(0, index);
			const match = text.substring(index, index + term.length);
			const after = text.substring(index + term.length);
			
			const fragment = activeDocument.createDocumentFragment();

			if (before) fragment.appendChild(activeDocument.createTextNode(before));

			const mark = activeDocument.createElement('mark');
			mark.className = 'search-highlight';
			mark.textContent = match;
			fragment.appendChild(mark);

			if (after) {
				// Recursively highlight remaining text
				const afterNode = activeDocument.createTextNode(after);
				fragment.appendChild(afterNode);
			}
			
			parent.replaceChild(fragment, textNode);
		}
	});
}

// Filters that only need file path/metadata (no content read required): pinned, folder, color.
// Safe to apply before any content-dependent pool truncation.
export function applyStructuralFilters(
	files: TFile[],
	searchState: SearchState,
	isPinned: (path: string) => boolean,
	getNoteColor: (path: string) => string | undefined
): TFile[] {
	let filtered = [...files];

	// Apply pinned filter
	if (searchState.filterPinned === 'pinned') {
		filtered = filtered.filter(f => isPinned(f.path));
	} else if (searchState.filterPinned === 'unpinned') {
		filtered = filtered.filter(f => !isPinned(f.path));
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

				const colorMap: Record<string, string> = {
					'pink': 'pastel-magenta',
					'peach': 'pastel-peach',
					'yellow': 'pastel-yellow',
					'green': 'pastel-green',
					'blue': 'pastel-blue',
					'purple': 'pastel-purple'
				};
				const expectedColor = colorMap[filterColor];
				if (!expectedColor) return false;
				return savedColor.includes(expectedColor);
			});

			return colorMatch;
		});
	}

	return filtered;
}

// Filters that require file content: tag, text query, has:/type: operators.
export function applyContentFilters(
	files: TFile[],
	fileContents: Map<string, string>,
	searchState: SearchState
): TFile[] {
	let filtered = [...files];

	// Apply tag filter
	if (searchState.filterTag) {
		filtered = filtered.filter(f => {
			const content = fileContents.get(f.path) || '';
			const tags = extractTags(content);
			return tags.includes(searchState.filterTag!);
		});
	}

	// Apply search filter with operators
	if (searchState.query) {
		const cleanQuery = getCleanQuery(searchState.query);

		filtered = filtered.filter(f => {
			const content = fileContents.get(f.path) || '';
			const tags = extractTags(content);

			// Check text search
			let matchesText = true;
			if (cleanQuery) {
				matchesText = f.basename.toLowerCase().includes(cleanQuery) ||
					content.toLowerCase().includes(cleanQuery);
			}

			// Check has: operators
			if (searchState.filterOperators.has('has')) {
				const hasValue = searchState.filterOperators.get('has');
				if (hasValue === 'tags' && tags.length === 0) return false;
				if (hasValue === 'content' && content.trim().length === 0) return false;
			}

			// Check type: operators
			if (searchState.filterOperators.has('type')) {
				const typeValue = searchState.filterOperators.get('type');
				const trimmedContent = content.trim();

				switch (typeValue) {
					case 'empty':
						if (trimmedContent.length > 0) return false;
						break;
					case 'image':
						// Match markdown images with image extensions
						// Supports: ![](image.jpg), ![[image.png]], and common image formats
						if (!content.match(/!\[.*?\]\([^)]*\.(png|jpg|jpeg|gif|bmp|svg|webp)[^)]*\)|!\[\[[^\]]*\.(png|jpg|jpeg|gif|bmp|svg|webp)[^\]]*\]\]/i)) return false;
						break;
					case 'pdf':
						// Match markdown embeds with PDF extensions
						// Supports: ![](document.pdf), ![[document.pdf]], [](document.pdf), [[document.pdf]]
						if (!content.match(/!?\[.*?\]\([^)]*\.pdf[^)]*\)|!?\[\[[^\]]*\.pdf[^\]]*\]\]/i)) return false;
						break;
					case 'link': {
						// Match links to pages, excluding images and PDFs
						// Excludes: links with ! prefix (embeds) and links to image/PDF files
						// Note: uses a captured non-'!' prefix instead of a negative lookbehind,
						// since lookbehinds aren't supported on iOS versions before 16.4
						const linkPattern = new RegExp(
							'(?:^|[^!])(?:\\[.*?\\]\\((?![^)]*\\.(?:png|jpg|jpeg|gif|bmp|svg|webp|pdf)\\b)[^)]+\\)|' +
							'\\[\\[(?![^\\]]*\\.(?:png|jpg|jpeg|gif|bmp|svg|webp|pdf)\\b)[^\\]]+\\]\\])',
							'i'
						);
						if (!content.match(linkPattern)) return false;
						break;
					}
					case 'list':
						if (!content.match(/^\s*[-*+]\s|^\s*\d+\.\s/m)) return false;
						break;
					case 'code':
						if (!content.match(/```[\s\S]*?```|`[^`|]+`/)) return false;
						break;
					case 'table':
						if (!content.match(/\|[^\n]*\|\n\|[\s:|-]+\|/)) return false;
						break;
				}
			}

			return matchesText;
		});
	}

	return filtered;
}

// Convenience wrapper combining structural + content filters, kept for API stability.
export function filterFiles(
	files: TFile[],
	fileContents: Map<string, string>,
	searchState: SearchState,
	isPinned: (path: string) => boolean,
	getNoteColor: (path: string) => string | undefined
): TFile[] {
	return applyContentFilters(
		applyStructuralFilters(files, searchState, isPinned, getNoteColor),
		fileContents,
		searchState
	);
}
