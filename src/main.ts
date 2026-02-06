import { Plugin, WorkspaceLeaf, addIcon, Notice, normalizePath } from 'obsidian';
import { DashboardData, DEFAULT_DATA, VIEW_TYPE_VISUAL_DASHBOARD, DASHBOARD_ICON } from './types';
import { VisualDashboardView } from './views/dashboard-view';
import { MiniNotesSettingTab } from './settings';

export default class VisualDashboardPlugin extends Plugin {
	data: DashboardData = DEFAULT_DATA;

	async onload() {
		try {
			await this.loadPluginData();
			await this.ensureMiniNotesFolder();

			// Register the custom icon
			addIcon('dashboard-grid', DASHBOARD_ICON);

		// Register the custom view
		this.registerView(
			VIEW_TYPE_VISUAL_DASHBOARD,
			(leaf) => new VisualDashboardView(leaf, this)
		);

		// Add ribbon icon to activate the view
		this.addRibbonIcon('dashboard-grid', 'Open mini notes', async () => {
			await this.activateView();
		});

		// Add command to open the dashboard
		this.addCommand({
			id: 'open-visual-dashboard',
			name: 'Open view',
			callback: async () => {
				await this.activateView();
			}
		});

		// Add command to focus search
		this.addCommand({
			id: 'focus-mini-notes-search',
			name: 'Focus search in mini notes',
			callback: () => {
				const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_VISUAL_DASHBOARD);
				if (leaves.length > 0) {
					(leaves[0]!.view as VisualDashboardView).focusSearch();
				}
			}
		});

		// Add command to create a new mini note
		this.addCommand({
			id: 'create-mini-note',
			name: 'Create new mini note',
			callback: async () => {
				await this.createMiniNote();
			}
		});

		// Add settings tab
		this.addSettingTab(new MiniNotesSettingTab(this.app, this));
		} catch (error) {
			console.error('Error loading Mini Notes plugin:', error);
		}
	}

	async loadPluginData() {
		try {
			const loadedData = await this.loadData() as DashboardData | null;
			this.data = Object.assign({}, DEFAULT_DATA, loadedData ?? {});
			
			// Migration: if sourceFolder is empty string, use the new default
			if (this.data.sourceFolder === '') {
				this.data.sourceFolder = DEFAULT_DATA.sourceFolder;
				await this.savePluginData();
			}
		} catch (error) {
			console.error('Error loading plugin data, using defaults:', error);
			this.data = DEFAULT_DATA;
		}
	}

	async savePluginData() {
		try {
			await this.saveData(this.data);
		} catch (error) {
			console.error('Error saving plugin data:', error);
		}
	}

	isPinned(filePath: string): boolean {
		return this.data.pinnedNotes.includes(filePath);
	}

	async togglePin(filePath: string): Promise<boolean> {
		try {
			const index = this.data.pinnedNotes.indexOf(filePath);
			if (index > -1) {
				this.data.pinnedNotes.splice(index, 1);
				await this.savePluginData();
				return false;
			} else {
				this.data.pinnedNotes.push(filePath);
				await this.savePluginData();
				return true;
			}
		} catch (error) {
			console.error('Error toggling pin:', error);
			return this.isPinned(filePath);
		}
	}

	getOrderIndex(filePath: string): number {
		return this.data.noteOrder.indexOf(filePath);
	}

	async updateOrder(newOrder: string[]) {
		try {
			this.data.noteOrder = newOrder;
			await this.savePluginData();
		} catch (error) {
			console.error('Error updating note order:', error);
		}
	}

	async ensureMiniNotesFolder() {
		try {
			const folderPath = normalizePath('Mini Notes');
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			
			if (!folder) {
				await this.app.vault.createFolder(folderPath);
				new Notice('Mini notes folder created');
			}
		} catch (error) {
			console.error('Error creating Mini Notes folder:', error);
		}
	}

	async createMiniNote() {
		try {
			// Always create notes in Mini Notes folder
			const folderPath = normalizePath('Mini Notes');
			
			// Ensure folder exists
			if (!this.app.vault.getAbstractFileByPath(folderPath)) {
				await this.app.vault.createFolder(folderPath);
			}
			
			// Generate filename with date only
			const now = new Date();
			const date = now.toLocaleDateString('en-CA'); // YYYY-MM-DD format
			
			// Find available filename
			let fileName = `${date}.md`;
			let filePath = normalizePath(`${folderPath}/${fileName}`);
			let counter = 1;
			
			while (this.app.vault.getAbstractFileByPath(filePath)) {
				fileName = `${date} (${counter}).md`;
				filePath = normalizePath(`${folderPath}/${fileName}`);
				counter++;
			}
			
			// Create empty file
			const content = '';
			const file = await this.app.vault.create(filePath, content);
			
			// Open the file in a new leaf
			const leaf = this.app.workspace.getLeaf('tab');
			await leaf.openFile(file);
			
			new Notice('New mini note created');
		} catch (error) {
			console.error('Error creating mini note:', error);
			new Notice('Failed to create mini note');
		}
	}

	async activateView() {
		try {
			const { workspace } = this.app;

			let leaf: WorkspaceLeaf | null = null;
			const leaves = workspace.getLeavesOfType(VIEW_TYPE_VISUAL_DASHBOARD);

			if (leaves.length > 0) {
				leaf = leaves[0]!;
			} else {
				leaf = workspace.getLeaf('tab');
				if (leaf) {
					await leaf.setViewState({
						type: VIEW_TYPE_VISUAL_DASHBOARD,
						active: true,
					});
				}
			}

			if (leaf) {
				await workspace.revealLeaf(leaf);
			}
		} catch (error) {
			console.error('Error activating view:', error);
		}
	}

	onunload() {
		// Don't detach leaves - let user's layout persist
	}
}
