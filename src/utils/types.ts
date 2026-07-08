export const VIEW_TYPE_VISUAL_DASHBOARD = 'visual-dashboard-view';

export const DASHBOARD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="5" x2="20" y2="5"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="19" x2="14" y2="19"/></svg>`;

export interface DashboardData {
	pinnedNotes: string[];
	noteOrder: string[]; 
	viewTitle: string; 
	sourceFolder: string; 
	createFolder: string;
	maxNotes: number;
	noteColors: Record<string, string>;
	themeColor: 'obsidian' | 'black' | 'custom';
	customThemeColor: string;
	showYamlFrontmatter: boolean;
}

export const DEFAULT_DATA: DashboardData = {
	pinnedNotes: [],
	noteOrder: [],
	viewTitle: 'Do Your Best Today!',
	sourceFolder: '/',
	createFolder: '/',
	maxNotes: 150,
	noteColors: {},
	themeColor: 'obsidian',
	customThemeColor: '#000000',
	showYamlFrontmatter: true
};
