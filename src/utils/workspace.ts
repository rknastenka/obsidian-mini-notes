import type { App, TFile, WorkspaceLeaf } from 'obsidian';

export async function openFileInNewTab(app: App, file: TFile, focus = true): Promise<WorkspaceLeaf> {
	const leaf = app.workspace.getLeaf('tab');
	await leaf.openFile(file, { active: focus });

	if (focus) {
		await app.workspace.revealLeaf(leaf);
	}

	return leaf;
}
