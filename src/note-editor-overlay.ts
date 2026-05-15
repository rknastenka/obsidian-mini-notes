import { App, TFile, MarkdownRenderer, setIcon, Component } from 'obsidian';

const AUTO_SAVE_DELAY_MS = 500;

export class NoteEditorOverlay extends Component {
	private app: App;
	private file: TFile;
	private mountEl: HTMLElement;       // the Mini Notes contentEl
	private overlayEl: HTMLElement | null = null;
	private backdropEl: HTMLElement | null = null;
	private textareaEl: HTMLTextAreaElement | null = null;
	private previewEl: HTMLElement | null = null;
	private titleEl: HTMLElement | null = null;
	private saveIndicatorEl: HTMLElement | null = null;
	private autoSaveTimer: number | null = null;
	private mode: 'edit' | 'preview' = 'preview';
	private currentContent = '';
	private isDirty = false;
	private keydownHandler: (e: KeyboardEvent) => void;

	constructor(app: App, file: TFile, mountEl: HTMLElement) {
		super();
		this.app = app;
		this.file = file;
		this.mountEl = mountEl;
		this.keydownHandler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') this.close();
		};
	}

	async open() {
		// Ensure component lifecycle is active for MarkdownRenderer child components (like PDFs)
		this.load();

		// Read file content first
		try {
			this.currentContent = await this.app.vault.read(this.file);
		} catch (err) {
			console.error('NoteEditorOverlay: failed to read file', err);
			return;
		}

		this.buildDOM();

		if (this.mode === 'preview') {
			await MarkdownRenderer.render(
				this.app,
				this.currentContent,
				this.previewEl!,
				this.file.path,
				this
			);
		}

		document.addEventListener('keydown', this.keydownHandler);
	}

	private buildDOM() {
		// --- Backdrop ---
		this.backdropEl = this.mountEl.createDiv({ cls: 'neo-backdrop' });
		this.backdropEl.addEventListener('mousedown', (e) => {
			if (e.target === this.backdropEl) this.close();
		});

		// --- Overlay panel ---
		this.overlayEl = this.backdropEl.createDiv({ cls: 'neo-panel' });

		// Prevent backdrop click when clicking inside panel
		this.overlayEl.addEventListener('mousedown', (e) => e.stopPropagation());

		this.buildHeader();
		this.buildBody();

		// Animate in
		requestAnimationFrame(() => {
			this.backdropEl?.addClass('neo-visible');
		});

		// If edit mode was default, we'd focus it here, but we default to preview
		if (this.mode === 'edit') {
			setTimeout(() => this.textareaEl?.focus(), 60);
		}
	}

	private buildHeader() {
		const header = this.overlayEl!.createDiv({ cls: 'neo-header' });

		// Title (editable on double-click — just shows filename for now)
		this.titleEl = header.createDiv({ cls: 'neo-title' });
		this.titleEl.textContent = this.file.basename;

		// Save indicator
		this.saveIndicatorEl = header.createDiv({ cls: 'neo-save-indicator' });
		this.saveIndicatorEl.textContent = 'Saved';

		// Right-side buttons
		const actions = header.createDiv({ cls: 'neo-actions' });

		// Mode toggle button
		const modeBtn = actions.createDiv({ cls: 'neo-btn', attr: { 'aria-label': 'Switch to edit' } });
		setIcon(modeBtn, 'pencil');
		modeBtn.addEventListener('click', () => {
			this.toggleMode(modeBtn);
		});

		// Open in tab button
		const openBtn = actions.createDiv({ cls: 'neo-btn', attr: { 'aria-label': 'Open in tab' } });
		setIcon(openBtn, 'external-link');
		openBtn.addEventListener('click', async () => {
			await this.saveNow();
			const leaf = this.app.workspace.getLeaf('tab');
			await leaf.openFile(this.file);
			this.close();
		});

		// Close button
		const closeBtn = actions.createDiv({ cls: 'neo-btn neo-btn-close', attr: { 'aria-label': 'Close' } });
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());
	}

	private buildBody() {
		const body = this.overlayEl!.createDiv({ cls: 'neo-body' });

		// --- Textarea (edit mode) ---
		this.textareaEl = body.createEl('textarea', { cls: 'neo-textarea' });
		this.textareaEl.value = this.currentContent;
		this.textareaEl.spellcheck = false;
		this.textareaEl.setAttribute('placeholder', 'Start writing...');
		this.textareaEl.style.display = 'none';

		this.textareaEl.addEventListener('input', () => {
			this.currentContent = this.textareaEl!.value;
			this.scheduleSave();
		});

		// --- Preview container (preview mode) ---
		this.previewEl = body.createDiv({ cls: 'neo-preview markdown-rendered' });
		this.previewEl.style.display = '';

		// Sync checkbox toggles in preview mode back to the source content
		this.previewEl.addEventListener('click', (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox' && target.classList.contains('task-list-item-checkbox')) {
				
				setTimeout(() => {
					const li = target.closest('li');
					let lineIdx = -1;
					const lines = this.currentContent.split('\n');

					if (li && li.hasAttribute('data-line')) {
						const lineStr = li.getAttribute('data-line');
						if (lineStr !== null) {
							lineIdx = parseInt(lineStr, 10);
						}
					} else if (li) {
						// Fallback: match by text content if data-line is missing
						let liText = li.textContent || '';
						const firstLine = liText.trim().split('\n')[0];
						liText = firstLine ? firstLine.trim() : '';
						if (liText) {
							const matchIdx = lines.findIndex(l => {
								return /^\s*(?:[-*+]|\d+\.)\s+\[[ \-xX]\]/.test(l) && l.includes(liText);
							});
							if (matchIdx !== -1) {
								lineIdx = matchIdx;
							}
						}
					}

					if (lineIdx >= 0 && lineIdx < lines.length) {
						const targetLine = lines[lineIdx];
						if (targetLine !== undefined) {
							const isChecked = (target as HTMLInputElement).checked;
							lines[lineIdx] = targetLine.replace(/\[[ \-xX]\]/, isChecked ? '[x]' : '[ ]');
							this.currentContent = lines.join('\n');
							this.textareaEl!.value = this.currentContent;
							this.scheduleSave();
						}
					}
				}, 10);
			}
		}, { capture: true });
	}

	private async toggleMode(modeBtn: HTMLElement) {
		if (this.mode === 'edit') {
			// Switch to preview
			this.mode = 'preview';
			setIcon(modeBtn, 'pencil');
			modeBtn.setAttribute('aria-label', 'Switch to edit');
			this.textareaEl!.style.display = 'none';
			this.previewEl!.style.display = '';
			this.previewEl!.empty();
			await MarkdownRenderer.render(
				this.app,
				this.currentContent,
				this.previewEl!,
				this.file.path,
				this
			);
		} else {
			// Switch to edit
			this.mode = 'edit';
			setIcon(modeBtn, 'eye');
			modeBtn.setAttribute('aria-label', 'Toggle preview');
			this.previewEl!.style.display = 'none';
			this.textareaEl!.style.display = '';
			this.textareaEl!.focus();
		}
	}

	private scheduleSave() {
		this.isDirty = true;
		this.setSaveIndicator('saving');

		if (this.autoSaveTimer !== null) {
			window.clearTimeout(this.autoSaveTimer);
		}
		this.autoSaveTimer = window.setTimeout(() => {
			void this.saveNow();
		}, AUTO_SAVE_DELAY_MS);
	}

	private async saveNow() {
		if (!this.isDirty) return;
		try {
			await this.app.vault.modify(this.file, this.currentContent);
			this.isDirty = false;
			this.setSaveIndicator('saved');
		} catch (err) {
			console.error('NoteEditorOverlay: save failed', err);
			this.setSaveIndicator('error');
		}
	}

	private setSaveIndicator(state: 'saving' | 'saved' | 'error') {
		if (!this.saveIndicatorEl) return;
		this.saveIndicatorEl.removeClass('neo-saving', 'neo-saved', 'neo-error');
		if (state === 'saving') {
			this.saveIndicatorEl.textContent = 'Saving…';
			this.saveIndicatorEl.addClass('neo-saving');
		} else if (state === 'saved') {
			this.saveIndicatorEl.textContent = 'Saved';
			this.saveIndicatorEl.addClass('neo-saved');
		} else {
			this.saveIndicatorEl.textContent = 'Save failed';
			this.saveIndicatorEl.addClass('neo-error');
		}
	}

	async close() {
		// Save any pending changes before closing
		if (this.isDirty) {
			if (this.autoSaveTimer !== null) {
				window.clearTimeout(this.autoSaveTimer);
				this.autoSaveTimer = null;
			}
			await this.saveNow();
		}

		document.removeEventListener('keydown', this.keydownHandler);

		// Animate out then remove
		if (this.backdropEl) {
			this.backdropEl.removeClass('neo-visible');
			setTimeout(() => {
				this.backdropEl?.remove();
				this.backdropEl = null;
				this.overlayEl = null;
			}, 200);
		}

		this.unload();
	}
}
