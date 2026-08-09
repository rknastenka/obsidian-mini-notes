export function normalizeFolderPath(folderPath: string): string {
	return folderPath
		.trim()
		.replace(/\\/g, '/')
		.replace(/^\/+|\/+$/g, '')
		.replace(/\/{2,}/g, '/');
}

export function parseExcludedFolders(value: string): string[] {
	return Array.from(new Set(
		value
			.split(/\r?\n/)
			.map(normalizeFolderPath)
			.filter(Boolean)
	));
}

export function isPathInFolder(filePath: string, folderPath: string): boolean {
	const normalizedFilePath = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
	const normalizedFolderPath = normalizeFolderPath(folderPath);

	if (!normalizedFolderPath) return false;

	return normalizedFilePath.startsWith(`${normalizedFolderPath}/`);
}

export function isPathExcluded(filePath: string, excludedFolders: string[]): boolean {
	return excludedFolders.some(folderPath => isPathInFolder(filePath, folderPath));
}
