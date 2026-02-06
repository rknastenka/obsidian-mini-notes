import { ItemView, TFile, WorkspaceLeaf, setIcon, MarkdownRenderer } from 'obsidian';
import type VisualDashboardPlugin from '../main';
import { VIEW_TYPE_VISUAL_DASHBOARD } from '../types';
import { extractTags, getPreviewText, stripMarkdown } from '../utils/markdown';
import { formatDate } from '../utils/date';
import { searchNote, highlightMatches, SearchResult } from '../utils/search';
import { FILE_FETCH_MULTIPLIER, DEBOUNCE_REFRESH_MS, DEBOUNCE_SEARCH_MS, MAX_PREVIEW_LENGTH, CARD_SIZE, MAX_CARD_HEIGHT } from '../constants';

export class VisualDashboardView extends ItemView {
	private miniNotesGrid!: HTMLElement;
	private plugin: VisualDashboardPlugin;
	private draggedCard: HTMLElement | null = null;
	private currentFiles: TFile[] = [];
	private settingsChangedHandler: () => void;
	private refreshTimeoutId: number | null = null;
	private eventsRegistered = false;

	// Filter state
	private filterPinned: 'all' | 'pinned' | 'unpinned' = 'all';
	private filterTag: string | null = null;
	private allTags: string[] = [];

	// Search state
	private searchQuery = '';
	private searchInputEl: HTMLInputElement | null = null;
	private searchTimeoutId: number | null = null;
	private currentSearchResults: Map<string, SearchResult> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: VisualDashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.settingsChangedHandler = () => {
			void this.refreshView();
		};
	}

	getViewType(): string {
		return VIEW_TYPE_VISUAL_DASHBOARD;
	}

	getDisplayText(): string {
		return 'Mini notes';
	}

	getIcon(): string {
		return 'dashboard-grid';
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();
		container.addClass('visual-dashboard-container');

		// Apply theme color
		this.applyThemeColor();

		// Create header - single row
		const header = this.contentEl.createDiv({ cls: 'dashboard-header' });

		// Title on left
		const title = header.createEl('h1', { text: this.plugin.data.viewTitle || 'Do Your Best Today!', cls: 'dashboard-title editable-title' });
		title.setAttribute('contenteditable', 'true');
		title.setAttribute('spellcheck', 'false');
		
		// Save title on blur
		title.addEventListener('blur', () => {
			const newTitle = title.textContent?.trim() || 'Do Your Best Today!';
			this.plugin.data.viewTitle = newTitle;
			void this.plugin.savePluginData();
		});
		
		// Save title on Enter key
		title.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				title.blur();
			}
		});
		
		// Reload on double-click
		title.addEventListener('dblclick', () => {
			void this.renderCards();
		});

		// Controls on right
		const controls = header.createDiv({ cls: 'header-controls' });

		// Search - collapsible input
		const searchWrapper = controls.createDiv({ cls: 'search-wrapper' });
		const searchToggle = searchWrapper.createDiv({ cls: 'filter-icon search-toggle-btn' });
		setIcon(searchToggle, 'search');

		const searchInput = searchWrapper.createEl('input', { cls: 'search-input' });
		searchInput.type = 'text';
		searchInput.placeholder = 'Search notes...';
		searchInput.spellcheck = false;
		this.searchInputEl = searchInput;

		const searchClear = searchWrapper.createDiv({ cls: 'filter-icon search-clear-btn' });
		setIcon(searchClear, 'x');

		// Restore search state if re-opening
		if (this.searchQuery) {
			searchWrapper.addClass('expanded');
			searchInput.value = this.searchQuery;
			searchToggle.addClass('active');
			searchClear.style.display = '';
		} else {
			searchClear.style.display = 'none';
		}

		searchToggle.addEventListener('click', () => {
			const isExpanded = searchWrapper.hasClass('expanded');
			if (isExpanded && !this.searchQuery) {
				searchWrapper.removeClass('expanded');
			} else {
				searchWrapper.addClass('expanded');
				searchInput.focus();
			}
		});

		searchInput.addEventListener('input', () => {
			this.searchQuery = searchInput.value;
			searchToggle.toggleClass('active', this.searchQuery.length > 0);
			searchClear.style.display = this.searchQuery.length > 0 ? '' : 'none';
			this.debouncedSearch();
		});

		searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				searchInput.value = '';
				this.searchQuery = '';
				searchToggle.removeClass('active');
				searchClear.style.display = 'none';
				searchWrapper.removeClass('expanded');
				void this.renderCards();
			}
		});

		searchClear.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			searchInput.value = '';
			this.searchQuery = '';
			searchToggle.removeClass('active');
			searchClear.style.display = 'none';
			searchWrapper.removeClass('expanded');
			void this.renderCards();
		});

		// Tag filter - icon with dropdown
		const tagWrapper = controls.createDiv({ cls: 'tag-filter-wrapper' });
		const tagIcon = tagWrapper.createDiv({ cls: 'filter-icon tag-filter-button' });
		setIcon(tagIcon, 'tag');

		// Create dropdown menu
		const dropdown = tagWrapper.createDiv({ cls: 'tag-dropdown-menu' });
		
		// Add "All tags" option
		const allOption = dropdown.createDiv({ cls: 'tag-dropdown-item' });
		allOption.textContent = 'All tags';
		allOption.addEventListener('click', () => {
			this.filterTag = null;
			tagIcon.toggleClass('active', false);
			dropdown.toggleClass('show', false);
			void this.renderCards();
		});

		// Toggle dropdown on click
		tagIcon.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			const isCurrentlyShown = dropdown.hasClass('show');
			dropdown.toggleClass('show', !isCurrentlyShown);
			if (!isCurrentlyShown) {
				void this.populateTagDropdown(dropdown, tagIcon);
			}
		});

		// Close dropdown when clicking outside
		this.registerDomEvent(document, 'click', () => {
			dropdown.toggleClass('show', false);
		});

		// Pin toggle icon
		const pinToggle = controls.createDiv({ cls: 'filter-icon' });
		setIcon(pinToggle, 'pin');
		pinToggle.setAttribute('aria-label', 'Show pinned only');
		pinToggle.addEventListener('click', () => {
			if (this.filterPinned === 'all') {
				this.filterPinned = 'pinned';
				pinToggle.addClass('active');
			} else {
				this.filterPinned = 'all';
				pinToggle.removeClass('active');
			}
			void this.renderCards();
		});

		// Create mini notes grid container
		this.miniNotesGrid = this.contentEl.createDiv({ cls: 'mini-notes-grid' });

		// Render the cards
		await this.renderCards();

		// Register event listeners only once
		if (!this.eventsRegistered) {
			this.setupEventListeners();
			this.eventsRegistered = true;
		}
	}

	private setupEventListeners() {
		// Listen for settings changes using workspace event
		this.registerEvent(
			// @ts-ignore - Custom event type
			this.app.workspace.on('mini-notes:settings-changed', this.settingsChangedHandler)
		);

		// Listen for file changes to auto-refresh
		this.registerEvent(
			this.app.vault.on('modify', () => this.debouncedRefresh())
		);
		this.registerEvent(
			this.app.vault.on('create', () => this.debouncedRefresh())
		);
		this.registerEvent(
			this.app.vault.on('delete', () => this.debouncedRefresh())
		);
	}

	private async refreshView() {
		// Update theme color
		this.applyThemeColor();
		
		// Update view title
		const titleElement = this.contentEl.querySelector('.dashboard-title') as HTMLElement;
		if (titleElement) {
			titleElement.textContent = this.plugin.data.viewTitle || 'Do Your Best Today!';
		}
		
		// Re-render cards to reflect setting changes
		await this.renderCards();
	}

	private populateTagDropdown(dropdown: HTMLElement, tagIcon: HTMLElement) {
		this.renderTagDropdownItems(dropdown, tagIcon);
	}

	private renderTagDropdownItems(dropdown: HTMLElement, tagIcon: HTMLElement) {
		// Remove existing tag items (keep "All tags" option)
		const existingTags = dropdown.querySelectorAll('.tag-dropdown-item:not(:first-child)');
		existingTags.forEach(el => el.remove());

		this.allTags.forEach(tag => {
			const item = dropdown.createDiv({ cls: 'tag-dropdown-item tag-pill' });
			item.textContent = tag;
			item.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				this.filterTag = tag;
				tagIcon.toggleClass('active', true);
				dropdown.toggleClass('show', false);
				void this.renderCards();
			});
		});
	}

	private debouncedRefresh() {
		if (this.refreshTimeoutId !== null) {
			window.clearTimeout(this.refreshTimeoutId);
		}
		
		this.refreshTimeoutId = window.setTimeout(() => {
			void this.renderCards();
			this.refreshTimeoutId = null;
		}, DEBOUNCE_REFRESH_MS);
	}

	private debouncedSearch() {
		if (this.searchTimeoutId !== null) {
			window.clearTimeout(this.searchTimeoutId);
		}

		this.searchTimeoutId = window.setTimeout(() => {
			void this.renderCards();
			this.searchTimeoutId = null;
		}, DEBOUNCE_SEARCH_MS);
	}

	public focusSearch(): void {
		if (this.searchInputEl) {
			const wrapper = this.searchInputEl.closest('.search-wrapper') as HTMLElement | null;
			wrapper?.addClass('expanded');
			this.searchInputEl.focus();
		}
	}

	private applyThemeColor() {
		const container = this.contentEl;
		let themeColor: string;

		switch (this.plugin.data.themeColor) {
			case 'black':
				themeColor = '#000000';
				break;
			case 'custom':
				themeColor = this.plugin.data.customThemeColor;
				break;
			case 'obsidian':
			default:
				// Use Obsidian's interactive accent color
				themeColor = getComputedStyle(document.body).getPropertyValue('--interactive-accent').trim();
				break;
		}

		// Set CSS custom property for theme color
		container.style.setProperty('--masonry-theme-color', themeColor);
	}

	async renderCards() {
		try {
			this.miniNotesGrid.empty();

			// Get all markdown files, filtered by source folder if specified
			let files = this.app.vault.getMarkdownFiles();
		
			// Filter by source folder if specified ("/" = all notes)
			const sourceFolder = this.plugin.data.sourceFolder.trim();
			if (sourceFolder && sourceFolder !== '/') {
				files = files.filter((file: TFile) => file.path.startsWith(sourceFolder));
			}
			
		// Filter out config folder files to avoid reading plugin/config files
		files = files.filter((file: TFile) => !file.path.startsWith(this.app.vault.configDir + '/'));
		
		files = files
			.sort((a: TFile, b: TFile) => b.stat.mtime - a.stat.mtime)
			.slice(0, this.plugin.data.maxNotes * FILE_FETCH_MULTIPLIER); // Get more initially for filtering

		// Pre-load content for tag filtering with error handling
		const fileContents = new Map<string, string>();
		const tagSet = new Set<string>();
		for (const file of files) {
			try {
				const content = await this.app.vault.cachedRead(file);
				fileContents.set(file.path, content);
				const tags = extractTags(content);
				tags.forEach(tag => tagSet.add(tag));
			} catch (error) {
				console.warn(`Failed to read file ${file.path}:`, error);
				fileContents.set(file.path, '');
			}
		}

		this.allTags = Array.from(tagSet).sort();

		// Apply pinned filter
		if (this.filterPinned === 'pinned') {
			files = files.filter((f: TFile) => this.plugin.isPinned(f.path));
		} else if (this.filterPinned === 'unpinned') {
			files = files.filter((f: TFile) => !this.plugin.isPinned(f.path));
		}

		// Apply tag filter
		if (this.filterTag) {
			files = files.filter((f: TFile) => {
				const content = fileContents.get(f.path) || '';
				const tags = extractTags(content);
				return tags.includes(this.filterTag!);
			});
		}

		// Apply search filter
		if (this.searchQuery.trim().length > 0) {
			const searchResults = new Map<string, SearchResult>();

			for (const file of files) {
				const content = fileContents.get(file.path) || '';
				const strippedContent = stripMarkdown(content);
				const tags = extractTags(content);
				const result = searchNote(this.searchQuery, file.basename, strippedContent, tags);

				if (result) {
					searchResults.set(file.path, result);
				}
			}

			files = files.filter(f => searchResults.has(f.path));
			this.currentSearchResults = searchResults;
		} else {
			this.currentSearchResults = null;
		}

		// Limit after filtering
		files = files.slice(0, this.plugin.data.maxNotes);

		// Separate and sort files by pin status
		const sortByOrder = (a: TFile, b: TFile) => {
			const aOrder = this.plugin.getOrderIndex(a.path);
			const bOrder = this.plugin.getOrderIndex(b.path);

			if (aOrder > -1 && bOrder > -1) return aOrder - bOrder;
			if (aOrder > -1) return -1;
			if (bOrder > -1) return 1;
			return b.stat.mtime - a.stat.mtime;
		};

		const pinnedFiles = files.filter(f => this.plugin.isPinned(f.path)).sort(sortByOrder);
		const unpinnedFiles = files.filter(f => !this.plugin.isPinned(f.path)).sort(sortByOrder);

		// Sort by relevance when search is active
		if (this.currentSearchResults) {
			const byRelevance = (a: TFile, b: TFile) => {
				const scoreA = this.currentSearchResults!.get(a.path)?.score ?? 0;
				const scoreB = this.currentSearchResults!.get(b.path)?.score ?? 0;
				return scoreB - scoreA;
			};
			pinnedFiles.sort(byRelevance);
			unpinnedFiles.sort(byRelevance);
		}

		// Store the combined order for drag-and-drop
		this.currentFiles = [...pinnedFiles, ...unpinnedFiles];

		if (files.length === 0) {
			const emptyState = this.miniNotesGrid.createDiv({ cls: 'dashboard-empty-state' });
			emptyState.createEl('h3', { text: 'No matching notes' });
			emptyState.createEl('p', { text: 'Try adjusting your filters' });
			return;
		}

		let globalIndex = 0;

		// Check if we need sections (both pinned and unpinned exist)
		const needsSections = pinnedFiles.length > 0 && unpinnedFiles.length > 0;

		if (needsSections) {
			// Render pinned section
			if (pinnedFiles.length > 0) {
				const pinnedGrid = this.miniNotesGrid.createDiv({ cls: 'mini-notes-grid-section' });
				for (const file of pinnedFiles) {
					const card = await this.createCard(file, globalIndex++);
					if (card) pinnedGrid.appendChild(card);
				}
			}

			// Separator line between sections
			this.miniNotesGrid.createDiv({ cls: 'section-separator' });

			// Render all notes section
			if (unpinnedFiles.length > 0) {
				const notesGrid = this.miniNotesGrid.createDiv({ cls: 'mini-notes-grid-section' });
				for (const file of unpinnedFiles) {
					const card = await this.createCard(file, globalIndex++);
					if (card) notesGrid.appendChild(card);
				}
			}
		} else {
			// Single section without header
			const singleGrid = this.miniNotesGrid.createDiv({ cls: 'mini-notes-grid-section' });
			for (const file of [...pinnedFiles, ...unpinnedFiles]) {
				const card = await this.createCard(file, globalIndex++);
				if (card) singleGrid.appendChild(card);
			}
		}
		} catch (error) {
			console.error('Error rendering cards:', error);
			const errorMsg = this.miniNotesGrid.createDiv({ cls: 'dashboard-error' });
			const errorText = errorMsg.createEl('p');
			errorText.createSpan({ text: 'Failed to render cards. Please open the console (Ctrl+Shift+I), screenshot the error, and ' });
			const link = errorText.createEl('a', { 
			text: 'Report it on GitHub',
				href: 'https://github.com/rknastenka/mini-notes/issues'
			});
			link.setAttribute('target', '_blank');
			errorText.createSpan({ text: '.' });
		}
	}

	async createCard(file: TFile, index: number): Promise<HTMLElement | null> {
		const card = document.createElement('div');
		card.addClass('dashboard-card');
		card.setAttribute('data-path', file.path);
		card.setAttribute('data-index', index.toString());
		card.setAttribute('draggable', 'true');

		try {
			// Get content and preview
			const content = await this.app.vault.cachedRead(file);
		const cleanContent = stripMarkdown(content);
		const previewLength = Math.min(cleanContent.length, MAX_PREVIEW_LENGTH);
		const previewText = getPreviewText(content, previewLength);

		// Dynamic sizing based on content length - more granular
		const contentLen = cleanContent.length;
		if (contentLen > CARD_SIZE.XL) {
			card.addClass('card-xl');
		} else if (contentLen > CARD_SIZE.LARGE) {
			card.addClass('card-large');
		} else if (contentLen > CARD_SIZE.MEDIUM) {
			card.addClass('card-medium');
		} else if (contentLen > CARD_SIZE.SMALL) {
			card.addClass('card-small');
		} else {
			card.addClass('card-xs');
		}

		// Check if pinned
		const isPinned = this.plugin.isPinned(file.path);
		if (isPinned) {
			card.addClass('card-pinned');
		}

		// Apply saved color if exists
		const savedColor = this.plugin.data.noteColors[file.path];
		if (savedColor) {
			card.style.backgroundColor = savedColor;
		}

		// Apply max height limit
		card.style.maxHeight = `${MAX_CARD_HEIGHT}px`;
		// Required to prevent card content from exceeding max height - dynamic styling needed per card
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		card.style.overflow = 'hidden';

		// Pin button (shows on hover)
		const pinBtn = card.createDiv({ cls: 'card-pin-btn' + (isPinned ? ' pinned' : '') });
		setIcon(pinBtn, 'pin');
		pinBtn.setAttribute('aria-label', isPinned ? 'Unpin note' : 'Pin note');
		pinBtn.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			void this.plugin.togglePin(file.path).then(async (nowPinned) => {
				pinBtn.classList.toggle('pinned', nowPinned);
				card.classList.toggle('card-pinned', nowPinned);
				await this.renderCards();
			});
		});

		// Color button (shows on hover) next to pin
		const colorBtn = card.createDiv({ cls: 'card-color-btn' });
		setIcon(colorBtn, 'palette');
		colorBtn.setAttribute('aria-label', 'Change note color');
		
		// Create color palette dropdown using CSS variables
		const pastelColors = [
			'var(--pastel-pink)',     // Pink
			'var(--pastel-peach)',    // Peach
			'var(--pastel-yellow)',   // Yellow
			'var(--pastel-green)',    // Green
			'var(--pastel-blue)',     // Blue
			'var(--pastel-purple)',   // Purple
			'var(--pastel-magenta)',  // Magenta
			'var(--pastel-gray)'      // Gray (remove color)
		];
		
		const colorDropdown = card.createDiv({ cls: 'card-color-dropdown' });
		
		pastelColors.forEach((color, index) => {
			const colorCircle = colorDropdown.createDiv({ cls: 'color-circle' });
			colorCircle.style.backgroundColor = color;
			
			// Last color is for removing
			if (index === pastelColors.length - 1) {
				colorCircle.addClass('color-circle-clear');
				colorCircle.setAttribute('aria-label', 'Remove color');
			} else {
				colorCircle.setAttribute('aria-label', 'Apply color');
			}
			
			colorCircle.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				
				void (async () => {
					if (index === pastelColors.length - 1) {
						// Remove color - required to reset dynamically applied background color
						// eslint-disable-next-line obsidianmd/no-static-styles-assignment
						card.style.backgroundColor = '';
						delete this.plugin.data.noteColors[file.path];
					} else {
						// Apply color using CSS variable
						card.style.backgroundColor = color;
						// Store the CSS variable name so it adapts to theme changes
						this.plugin.data.noteColors[file.path] = color;
					}
					
					await this.plugin.savePluginData();
					colorDropdown.removeClass('show');
				})();
			});
		});
		
		// Toggle dropdown on click
		colorBtn.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			colorDropdown.toggleClass('show', !colorDropdown.hasClass('show'));
		});
		
		// Close dropdown when clicking outside
		card.addEventListener('click', () => {
			colorDropdown.removeClass('show');
		});

		// Card header with file info
		const cardHeader = card.createDiv({ cls: 'card-header' });

		// Title
		const title = cardHeader.createEl('h3', {
			text: file.basename,
			cls: 'card-title'
		});
		title.setAttribute('title', file.basename);

		// Card content (preview) - render with Obsidian's markdown renderer
		const cardContent = card.createDiv({ cls: 'card-content' });
		if (previewText.trim()) {
			const previewContainer = cardContent.createDiv({ cls: 'card-preview' });
			// Render markdown natively with Obsidian's renderer
			await MarkdownRenderer.render(
				this.app,
				previewText,
				previewContainer,
				file.path,
				this
			);
		} else {
			cardContent.createEl('p', {
				text: 'Empty note...',
				cls: 'card-preview card-preview-empty'
			});
		}

		// Card footer with metadata
		const cardFooter = card.createDiv({ cls: 'card-footer' });

		// Tags on left
		const tagsContainer = cardFooter.createDiv({ cls: 'card-tags' });
		const tags = extractTags(content);
		if (tags.length > 0) {
			tags.slice(0, 3).forEach(tag => {
				tagsContainer.createSpan({ cls: 'card-tag', text: tag });
			});
			if (tags.length > 3) {
				tagsContainer.createSpan({ cls: 'card-tag-more', text: `+${tags.length - 3}` });
			}
		}
		
		// Highlight search matches in title, preview, and tags
		if (this.searchQuery && this.currentSearchResults?.has(file.path)) {
			highlightMatches(title, this.searchQuery);
			const previewEl = cardContent.querySelector('.card-preview') as HTMLElement | null;
			if (previewEl) {
				highlightMatches(previewEl, this.searchQuery);
			}
			tagsContainer.querySelectorAll('.card-tag').forEach(tagEl => {
				highlightMatches(tagEl as HTMLElement, this.searchQuery);
			});
		}

		// Date on right
		const dateSpan = cardFooter.createSpan({ cls: 'card-date' });
		dateSpan.createSpan({ text: formatDate(file.stat.mtime) });

		// Click handler to open the note
		card.addEventListener('click', (e: MouseEvent) => {
			// Don't open if clicking pin button or during drag
			if ((e.target as HTMLElement).closest('.card-pin-btn')) return;
			const leaf = this.app.workspace.getLeaf('tab');
			void leaf.openFile(file);
		});

		// Drag and drop handlers
		card.addEventListener('dragstart', (e: DragEvent) => this.handleDragStart(e, card));
		card.addEventListener('dragend', (e: DragEvent) => this.handleDragEnd(e, card));
		card.addEventListener('dragover', (e: DragEvent) => this.handleDragOver(e, card));
		card.addEventListener('dragenter', (e: DragEvent) => this.handleDragEnter(e, card));
		card.addEventListener('dragleave', (e: DragEvent) => this.handleDragLeave(e, card));
		card.addEventListener('drop', (e: DragEvent) => void this.handleDrop(e, card));
		} catch (error) {
			console.warn(`Skipping card for ${file.path} due to error:`, error);
			// Return null to skip this card entirely
			return null;
		}

		return card;
	}

	// Drag and Drop Handlers
	handleDragStart(e: DragEvent, card: HTMLElement) {
		this.draggedCard = card;
		card.classList.add('dragging');

		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', card.getAttribute('data-path') || '');
		}
	}

	handleDragEnd(e: DragEvent, card: HTMLElement) {
		card.classList.remove('dragging');
		this.draggedCard = null;

		// Remove all drag-over classes
		this.miniNotesGrid.querySelectorAll('.drag-over').forEach(el => {
			el.classList.remove('drag-over');
		});
	}

	handleDragOver(e: DragEvent, card: HTMLElement) {
		e.preventDefault();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}
	}

	handleDragEnter(e: DragEvent, card: HTMLElement) {
		e.preventDefault();
		if (card !== this.draggedCard) {
			card.classList.add('drag-over');
		}
	}

	handleDragLeave(e: DragEvent, card: HTMLElement) {
		card.classList.remove('drag-over');
	}

	handleDrop(e: DragEvent, targetCard: HTMLElement) {
		e.preventDefault();
		targetCard.classList.remove('drag-over');

		if (!this.draggedCard || this.draggedCard === targetCard) return;

		const draggedPath = this.draggedCard.getAttribute('data-path');
		const targetPath = targetCard.getAttribute('data-path');

		if (!draggedPath || !targetPath) return;

		// Get current order
		const currentOrder = this.currentFiles.map(f => f.path);

		// Find indices
		const draggedIndex = currentOrder.indexOf(draggedPath);
		const targetIndex = currentOrder.indexOf(targetPath);

		if (draggedIndex === -1 || targetIndex === -1) return;

		// Reorder
		currentOrder.splice(draggedIndex, 1);
		currentOrder.splice(targetIndex, 0, draggedPath);

		// Save new order and re-render
		void this.plugin.updateOrder(currentOrder).then(() => this.renderCards());
	}

async onClose() {
	if (this.searchTimeoutId !== null) {
			window.clearTimeout(this.searchTimeoutId);
		}
		// Event cleanup handled automatically by registerEvent
		this.contentEl.empty();
	}
}
