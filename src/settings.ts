import { App, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type VisualDashboardPlugin from './main';
import { PASTEL_SWATCHES } from './utils/constants';

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
					.filter(path => path !== '' && path !== '/');
				
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
					.filter(path => path !== '' && path !== '/');
				
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
			.setName('Maximum checklist items per card')
			.setDesc('Maximum number of checklist items to show in a card before collapsing extra items into a "+n more" indicator. Set to 0 for no limit.')
			.addText(text => text
				.setPlaceholder('8')
				.setValue(String(this.plugin.data.maxChecklistItems))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num >= 0) {
						this.plugin.data.maxChecklistItems = num;
						await this.plugin.savePluginData();
					}
				})
			);

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
						colorSetting.toggleClass('is-hidden', value !== 'custom');
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
		customColorSetting.settingEl.toggleClass('is-hidden', this.plugin.data.themeColor !== 'custom');

		new Setting(containerEl)
			.setName('Show YAML frontmatter')
			.setDesc('Display the YAML frontmatter block in note previews')
			.addToggle(toggle => toggle
				.setValue(this.plugin.data.showYamlFrontmatter)
				.onChange(async (value) => {
					this.plugin.data.showYamlFrontmatter = value;
					await this.plugin.savePluginData();
					this.app.workspace.trigger('mini-notes:settings-changed');
				})
			);

		new Setting(containerEl)
			.setName('Tag colors')
			.setDesc('Automatically color a note based on its tags (e.g. #health → green). A manually chosen note color always takes priority; if a note has more than one mapped tag, whichever appears first in the note wins.')
			.setHeading();

		Object.entries(this.plugin.data.tagColors).forEach(([tag, color]) => {
			new Setting(containerEl)
				.setName(tag)
				.addDropdown(dropdown => {
					PASTEL_SWATCHES.forEach(swatch => {
						dropdown.addOption(swatch.value, swatch.name);
					});
					dropdown.setValue(color);
					dropdown.onChange(async (value) => {
						this.plugin.data.tagColors[tag] = value;
						await this.plugin.savePluginData();
						this.app.workspace.trigger('mini-notes:settings-changed');
					});
				})
				.addExtraButton(button => button
					.setIcon('trash')
					.setTooltip('Remove mapping')
					.onClick(async () => {
						delete this.plugin.data.tagColors[tag];
						await this.plugin.savePluginData();
						this.app.workspace.trigger('mini-notes:settings-changed');
						this.display();
					})
				);
		});

		let newTagColorTag = '';
		let newTagColorValue: string = PASTEL_SWATCHES[0].value;
		new Setting(containerEl)
			.setName('Add tag color')
			.addText(text => text
				.setPlaceholder('#tagname')
				.onChange(value => {
					newTagColorTag = value;
				})
			)
			.addDropdown(dropdown => {
				PASTEL_SWATCHES.forEach(swatch => {
					dropdown.addOption(swatch.value, swatch.name);
				});
				dropdown.setValue(newTagColorValue);
				dropdown.onChange(value => {
					newTagColorValue = value;
				});
			})
			.addButton(button => button
				.setButtonText('Add')
				.setCta()
				.onClick(async () => {
					const trimmed = newTagColorTag.trim();
					if (!trimmed) return;
					const tag = trimmed.startsWith('#') ? trimmed : '#' + trimmed;
					this.plugin.data.tagColors[tag] = newTagColorValue;
					await this.plugin.savePluginData();
					this.app.workspace.trigger('mini-notes:settings-changed');
					this.display();
				})
			);

		// Footer with GitHub link
		const footer = containerEl.createDiv({ cls: 'mini-notes-settings-footer' });
		const footerContent = footer.createDiv({ cls: 'mini-notes-settings-footer-content' });

		footerContent.createSpan({ text: 'Built by ' });

		const link = footerContent.createEl('a', {
			text: 'Rknastenka.com',
			href: 'https://rknastenka.com',
			cls: 'mini-notes-settings-footer-link'
		});
		link.setAttribute('target', '_blank');

		const githubIcon = footerContent.createSpan({ cls: 'mini-notes-settings-footer-github-icon' });
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
