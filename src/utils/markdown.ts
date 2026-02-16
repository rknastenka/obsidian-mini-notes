// Extract tags from markdown content
export function extractTags(content: string): string[] {
	// First, remove code blocks (``` ... ```) and inline code (` ... `)
	const contentWithoutCode = content
		.replace(/```[\s\S]*?```/g, '') // Remove code blocks
		.replace(/`[^`]*`/g, ''); // Remove inline code
	
	// Updated regex to support Unicode characters including emoticons/emoji
	const tagRegex = /(?:^|\s)#([\p{L}\p{N}\p{Emoji}_-][\p{L}\p{N}\p{Emoji}_-]*)/gu;
	const tags: string[] = [];
	let match;

	while ((match = tagRegex.exec(contentWithoutCode)) !== null) {
		const tag = '#' + match[1];
		if (!tags.includes(tag)) {
			tags.push(tag);
		}
	}

	return tags;
}

// Strip markdown formatting from content
export function stripMarkdown(content: string): string {
	return content
		.replace(/^---[\s\S]*?---\n?/, '') // YAML frontmatter
		.replace(/^#+\s+/gm, '') // Headers
		.replace(/\*\*(.+?)\*\*/g, '$1') // Bold
		.replace(/\*(.+?)\*/g, '$1') // Italic
		.replace(/__(.+?)__/g, '$1') // Bold alt
		.replace(/_(.+?)_/g, '$1') // Italic alt
		.replace(/~~(.+?)~~/g, '$1') // Strikethrough
		.replace(/`{1,3}[^`]*`{1,3}/g, '') // Code
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, '') // Images
		.replace(/^>\s+/gm, '') // Blockquotes
		.replace(/^[-*+]\s+/gm, '') // List items
		.replace(/^\d+\.\s+/gm, '') // Numbered lists
		.replace(/(?:^|\s)#[\p{L}\p{N}\p{Emoji}_-]+/gu, '') // Remove tags (supports Unicode/emoji)
		.trim();
}

// Get preview text from content, stripped of markdown and truncated
export function getPreviewText(content: string, maxLength: number): string {
	let text = stripMarkdown(content);
	text = text.replace(/\n{2,}/g, '\n').trim();

	if (text.length > maxLength) {
		text = text.substring(0, maxLength).trim() + '...';
	}

	return text;
}
