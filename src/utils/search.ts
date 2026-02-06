// --- Scoring constants (fzf/Sublime Text inspired) ---
const SCORE_WORD_START = 0.8;
const SCORE_CAMEL_BOUNDARY = 0.7;
const SCORE_FIRST_CHAR = 0.6;
const SCORE_CONSECUTIVE_BASE = 0.15;
const SCORE_CONSECUTIVE_GROWTH = 0.05;
const GAP_PENALTY = 0.03;
const MAX_GAP_PENALTY = 0.6;
const MIN_QUALITY_THRESHOLD = 0.3;
const BODY_SEARCH_LIMIT = 2000;

const WEIGHT_TITLE = 100;
const WEIGHT_TAGS = 70;
const WEIGHT_BODY = 40;

// --- Types ---

export interface SearchResult {
	score: number;
}

interface MatchRange {
	start: number;
	end: number;
}

interface FuzzyResult {
	matched: boolean;
	score: number;
	ranges: MatchRange[];
}

const NO_MATCH: FuzzyResult = { matched: false, score: 0, ranges: [] };

// --- Helpers (charCode-based, zero allocation) ---

function isWordBoundaryAt(str: string, index: number): boolean {
	if (index === 0) return true;
	const prev = str.charCodeAt(index - 1);
	// space=32, tab=9, /=47, -=45, _=95, .=46
	return prev === 32 || prev === 9 || prev === 47 || prev === 45 || prev === 95 || prev === 46;
}

function isCamelBoundaryAt(str: string, index: number): boolean {
	if (index === 0) return false;
	const prev = str.charCodeAt(index - 1);
	const curr = str.charCodeAt(index);
	return prev >= 97 && prev <= 122 && curr >= 65 && curr <= 90;
}

// --- Core fuzzy scoring ---

function fuzzyScore(
	needle: string,
	needleLower: string,
	haystack: string,
	haystackLower: string
): FuzzyResult {
	if (needleLower.length === 0 || haystackLower.length === 0) return NO_MATCH;
	if (needleLower.length > haystackLower.length) return NO_MATCH;

	// Early exit: first char not present
	if (haystackLower.indexOf(needleLower[0]!) === -1) return NO_MATCH;

	// Fast path: exact substring match
	const subIdx = haystackLower.indexOf(needleLower);
	if (subIdx !== -1) {
		let score = 1.0;
		if (subIdx === 0) score += SCORE_FIRST_CHAR;
		if (isWordBoundaryAt(haystack, subIdx)) score += SCORE_WORD_START;
		if (isCamelBoundaryAt(haystack, subIdx)) score += SCORE_CAMEL_BOUNDARY;
		return {
			matched: true,
			score,
			ranges: [{ start: subIdx, end: subIdx + needle.length }]
		};
	}

	// Fuzzy path: sequential character matching with scoring
	let needleIdx = 0;
	let lastMatchPos = -1;
	let consecutiveCount = 0;
	let charBonuses = 0;
	let totalGapPenalty = 0;
	let firstMatchPos = -1;

	const ranges: MatchRange[] = [];
	let currentRangeStart = -1;
	let currentRangeEnd = -1;

	for (let i = 0; i < haystackLower.length && needleIdx < needleLower.length; i++) {
		if (haystackLower[i] !== needleLower[needleIdx]) continue;

		// Record first match position
		if (firstMatchPos === -1) firstMatchPos = i;

		let bonus = 0;

		// Word boundary bonus
		if (isWordBoundaryAt(haystack, i)) bonus += SCORE_WORD_START;

		// CamelCase boundary bonus
		if (isCamelBoundaryAt(haystack, i)) bonus += SCORE_CAMEL_BOUNDARY;

		// First char bonus
		if (needleIdx === 0 && i === 0) bonus += SCORE_FIRST_CHAR;

		// Consecutive bonus (compounds with run length)
		if (lastMatchPos === i - 1) {
			consecutiveCount++;
			bonus += SCORE_CONSECUTIVE_BASE + consecutiveCount * SCORE_CONSECUTIVE_GROWTH;
			// Extend current range
			currentRangeEnd = i + 1;
		} else {
			consecutiveCount = 0;
			// Gap penalty
			if (lastMatchPos >= 0) {
				const gap = i - lastMatchPos - 1;
				totalGapPenalty += Math.min(gap * GAP_PENALTY, MAX_GAP_PENALTY);
			}
			// Finish previous range and start new one
			if (currentRangeStart !== -1) {
				ranges.push({ start: currentRangeStart, end: currentRangeEnd });
			}
			currentRangeStart = i;
			currentRangeEnd = i + 1;
		}

		charBonuses += bonus;
		lastMatchPos = i;
		needleIdx++;
	}

	// Not all chars matched
	if (needleIdx !== needleLower.length) return NO_MATCH;

	// Push final range
	if (currentRangeStart !== -1) {
		ranges.push({ start: currentRangeStart, end: currentRangeEnd });
	}

	// Calculate final score
	const spread = lastMatchPos - firstMatchPos + 1;
	const spreadRatio = needle.length / spread;
	const normalizedBonuses = charBonuses / needle.length;
	const finalScore = Math.max(
		0,
		Math.min(spreadRatio * 0.5 + normalizedBonuses * 0.5 - totalGapPenalty, 0.99)
	);

	if (finalScore < MIN_QUALITY_THRESHOLD) return NO_MATCH;

	return { matched: true, score: finalScore, ranges };
}

// --- Typo tolerance wrapper ---

function fuzzyScoreWithTypos(
	needle: string,
	needleLower: string,
	haystack: string,
	haystackLower: string
): FuzzyResult {
	// Try exact first
	const result = fuzzyScore(needle, needleLower, haystack, haystackLower);
	if (result.matched) return result;

	// Need at least 2 chars for typo recovery
	if (needleLower.length < 2) return NO_MATCH;

	// Strategy A: Transposition for short queries (<=5 chars)
	if (needleLower.length <= 5) {
		for (let i = 0; i < needleLower.length - 1; i++) {
			const swapped = needleLower.slice(0, i) + needleLower[i + 1]! + needleLower[i]! + needleLower.slice(i + 2);
			const swappedOrig = needle.slice(0, i) + needle[i + 1]! + needle[i]! + needle.slice(i + 2);
			const typoResult = fuzzyScore(swappedOrig, swapped, haystack, haystackLower);
			if (typoResult.matched) {
				return { ...typoResult, score: typoResult.score * 0.9 };
			}
		}
	}

	// Strategy B: Single char deletion for longer queries (>3 chars)
	if (needleLower.length > 3) {
		for (let i = 0; i < needleLower.length; i++) {
			const shortened = needleLower.slice(0, i) + needleLower.slice(i + 1);
			const shortenedOrig = needle.slice(0, i) + needle.slice(i + 1);
			const typoResult = fuzzyScore(shortenedOrig, shortened, haystack, haystackLower);
			if (typoResult.matched) {
				return { ...typoResult, score: typoResult.score * 0.85 };
			}
		}
	}

	return NO_MATCH;
}

// --- Multi-field search ---

export function searchNote(query: string, title: string, body: string, tags: string[]): SearchResult | null {
	const words = query.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
	if (words.length === 0) return null;

	// Pre-process fields once
	const titleLower = title.toLowerCase();
	const bodyTruncated = body.slice(0, BODY_SEARCH_LIMIT);
	const bodyLower = bodyTruncated.toLowerCase();
	const processedTags = tags.map(t => {
		const stripped = t.startsWith('#') ? t.slice(1) : t;
		return { original: stripped, lower: stripped.toLowerCase() };
	});

	let totalScore = 0;

	for (const word of words) {
		let bestWordScore = 0;

		// Check title
		const titleResult = fuzzyScoreWithTypos(word, word, title, titleLower);
		if (titleResult.matched) {
			bestWordScore = Math.max(bestWordScore, titleResult.score * WEIGHT_TITLE);
		}

		// Check tags
		for (const tag of processedTags) {
			const tagResult = fuzzyScoreWithTypos(word, word, tag.original, tag.lower);
			if (tagResult.matched) {
				bestWordScore = Math.max(bestWordScore, tagResult.score * WEIGHT_TAGS);
			}
		}

		// Check body - exact substring only (fuzzy on long text = false positives)
		if (bestWordScore < WEIGHT_BODY * 0.8) {
			const bodyResult = fuzzyScore(word, word, bodyTruncated, bodyLower);
			// Only accept exact substring matches for body (score >= 1.0)
			if (bodyResult.matched && bodyResult.score >= 1.0) {
				bestWordScore = Math.max(bestWordScore, bodyResult.score * WEIGHT_BODY);
			}
		}

		if (bestWordScore === 0) return null; // AND semantics: all words must match

		totalScore += bestWordScore;
	}

	return { score: totalScore };
}

// --- Highlighting ---

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
	if (ranges.length === 0) return [];
	ranges.sort((a, b) => a.start - b.start);

	const merged: MatchRange[] = [{ start: ranges[0]!.start, end: ranges[0]!.end }];
	for (let i = 1; i < ranges.length; i++) {
		const current = ranges[i]!;
		const last = merged[merged.length - 1]!;
		if (current.start <= last.end) {
			last.end = Math.max(last.end, current.end);
		} else {
			merged.push({ start: current.start, end: current.end });
		}
	}
	return merged;
}

export function highlightMatches(container: HTMLElement, query: string): void {
	if (!query.trim()) return;

	const words = query.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);

	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	const textNodes: Text[] = [];

	let node: Node | null;
	while ((node = walker.nextNode())) {
		textNodes.push(node as Text);
	}

	for (const textNode of textNodes) {
		const text = textNode.textContent || '';
		if (text.length === 0) continue;
		const lowerText = text.toLowerCase();

		const highlights: MatchRange[] = [];

		for (const word of words) {
			// Try exact substring matches first
			let pos = 0;
			let foundExact = false;
			while ((pos = lowerText.indexOf(word, pos)) !== -1) {
				highlights.push({ start: pos, end: pos + word.length });
				pos += word.length;
				foundExact = true;
			}

			// Fallback: fuzzy match for character-level highlighting
			if (!foundExact) {
				const result = fuzzyScore(word, word, text, lowerText);
				if (result.matched) {
					for (const range of result.ranges) {
						highlights.push(range);
					}
				}
			}
		}

		if (highlights.length === 0) continue;

		const merged = mergeRanges(highlights);

		const fragment = document.createDocumentFragment();
		let lastEnd = 0;

		for (const range of merged) {
			if (range.start > lastEnd) {
				fragment.appendChild(document.createTextNode(text.slice(lastEnd, range.start)));
			}
			const mark = document.createElement('mark');
			mark.className = 'search-highlight';
			mark.textContent = text.slice(range.start, range.end);
			fragment.appendChild(mark);
			lastEnd = range.end;
		}

		if (lastEnd < text.length) {
			fragment.appendChild(document.createTextNode(text.slice(lastEnd)));
		}

		textNode.parentNode?.replaceChild(fragment, textNode);
	}
}
