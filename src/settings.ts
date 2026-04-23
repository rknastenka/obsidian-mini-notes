import { App, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type VisualDashboardPlugin from './main';

export class MiniNotesSettingTab extends PluginSettingTab {
	plugin: VisualDashboardPlugin;

	constructor(app: App, plugin: VisualDashboardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('View title')
			.setDesc('Custom title for the view')
			.addText(text => text
				.setPlaceholder('Do your best today!')
				.setValue(this.plugin.data.viewTitle)
				.onChange(async (value) => {
					this.plugin.data.viewTitle = value || 'Do Your Best Today!';
					await this.plugin.savePluginData();
				})
			);

		new Setting(containerEl)
			.setName('Source folder')
			.setDesc('Folder to fetch notes from')
			.addDropdown(dropdown => {
				// Get all folders in vault
				const folders = this.app.vault.getAllLoadedFiles()
					.filter(file => 'children' in file && file.children !== undefined)
					.map(folder => folder.path)
					.filter(path => path !== '');
				
				dropdown.addOption('/', 'All notes');
				
				// Add other folders
				folders.forEach(folder => {
					dropdown.addOption(folder, folder);
				});
				
				dropdown.setValue(this.plugin.data.sourceFolder);
				dropdown.onChange(async (value) => {
					this.plugin.data.sourceFolder = value;
					await this.plugin.savePluginData();
					this.app.workspace.trigger('mini-notes:settings-changed');
				});
			});

		new Setting(containerEl)
			.setName('Create folder')
			.setDesc('Folder where new mini notes will be created')
			.addDropdown(dropdown => {
				// Get all folders in vault
				const folders = this.app.vault.getAllLoadedFiles()
					.filter(file => 'children' in file && file.children !== undefined)
					.map(folder => folder.path)
					.filter(path => path !== '');
				
				// Add root as an option
				dropdown.addOption('/', 'Root folder');
				
				// Add other folders
				folders.forEach(folder => {
					dropdown.addOption(folder, folder);
				});
				
				dropdown.setValue(this.plugin.data.createFolder);
				dropdown.onChange(async (value) => {
					this.plugin.data.createFolder = value;
					await this.plugin.savePluginData();
				});
			});

		new Setting(containerEl)
			.setName('Maximum notes')
			.setDesc('Maximum number of notes to display (more than 300 is not recommended)')
			.addText(text => text
				.setPlaceholder('150')
				.setValue(String(this.plugin.data.maxNotes))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						this.plugin.data.maxNotes = num;
						await this.plugin.savePluginData();
					}
				})
			);

		new Setting(containerEl)
			.setName('Preview length')
			.setDesc('Controls how much of each note is shown in the card view')
			.addDropdown(dropdown => {
				dropdown.addOption('short', 'Short');
				dropdown.addOption('medium', 'Medium');
				dropdown.addOption('long', 'Long');
				dropdown.setValue(this.plugin.data.previewLength || 'long');
				dropdown.onChange(async (value) => {
					this.plugin.data.previewLength = value as 'short' | 'medium' | 'long';
					await this.plugin.savePluginData();
					this.app.workspace.trigger('mini-notes:settings-changed');
				});
			});

		new Setting(containerEl)
			.setName('Theme color')
			.setDesc('Color for borders, pins, and accents')
			.addDropdown(dropdown => {
				dropdown.addOption('obsidian', 'Use Obsidian theme');
				dropdown.addOption('black', 'Black');
				dropdown.addOption('custom', 'Custom color');
				dropdown.setValue(this.plugin.data.themeColor);
				dropdown.onChange(async (value) => {
					this.plugin.data.themeColor = value as 'obsidian' | 'black' | 'custom';
					await this.plugin.savePluginData();
					this.app.workspace.trigger('mini-notes:settings-changed');
					// Show/hide custom color picker
					const colorSetting = containerEl.querySelector('.custom-color-setting') as HTMLElement;
					if (colorSetting) {
						colorSetting.style.display = value === 'custom' ? 'flex' : 'none';
					}
				});
			});

		const customColorSetting = new Setting(containerEl)
			.setName('Custom theme color')
			.setDesc('Choose a custom color for borders, pins, and accents')
			.addColorPicker(colorPicker => colorPicker
				.setValue(this.plugin.data.customThemeColor)
				.onChange(async (value) => {
					this.plugin.data.customThemeColor = value;
					await this.plugin.savePluginData();
					this.app.workspace.trigger('mini-notes:settings-changed');
				}));
		
		// Set initial visibility of custom color setting
		customColorSetting.settingEl.addClass('custom-color-setting');
		customColorSetting.settingEl.style.display = this.plugin.data.themeColor === 'custom' ? 'flex' : 'none';

		// Footer with GitHub link
		const footer = containerEl.createDiv();
		// Required for proper footer spacing and layout - CSS classes not available for settings footer
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		footer.style.borderTop = 'none';
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		footer.style.paddingTop = '1em';
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		footer.style.background = 'none';
		
		const footerContent = footer.createDiv();
		// Required for proper footer content layout - CSS classes not available for settings footer
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		footerContent.style.display = 'flex';
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		footerContent.style.alignItems = 'center';
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		footerContent.style.gap = '0.5em';
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		footerContent.style.fontSize = '0.7em';
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		footerContent.style.color = 'var(--text-muted)';
		
		footerContent.createSpan({ text: 'Built by ' });
		
		const link = footerContent.createEl('a', {
			text: 'Rknastenka.com',
			href: 'https://rknastenka.com'
		});
		// Required to match footer text color - CSS classes not available for settings footer links
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		link.style.color = 'var(--text-muted)';
		link.setAttribute('target', '_blank');
		
		const githubIcon = footerContent.createSpan();
		// Required for proper icon display and interaction - CSS classes not available for settings footer icons
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		githubIcon.style.display = 'flex';
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		githubIcon.style.cursor = 'pointer';
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		githubIcon.style.marginLeft = '0.5em';
		setIcon(githubIcon, 'github');
		githubIcon.addEventListener('click', () => {
			window.open('https://github.com/rknastenka/mini-notes', '_blank');
		});
	}

	hide(): void {
		// Trigger refresh when settings are closed
		this.app.workspace.trigger('mini-notes:settings-changed');
	}
}
