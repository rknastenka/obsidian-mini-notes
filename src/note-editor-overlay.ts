import { App, TFile, MarkdownRenderer, setIcon, Component, Menu } from 'obsidian';
import { openFileInNewTab } from './utils/workspace';

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
	private previewRenderComponent: Component | null = null;
	private isClosed = false;
	private onDidClose?: () => void;
	private closePromise: Promise<void> | null = null;
	private previewGeneration = 0;

	constructor(app: App, file: TFile, mountEl: HTMLElement, onDidClose?: () => void) {
		super();
		this.app = app;
		this.file = file;
		this.mountEl = mountEl;
		this.onDidClose = onDidClose;
		this.keydownHandler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') void this.close();
		};
	}

	async open(): Promise<boolean> {
		// Ensure component lifecycle is active for MarkdownRenderer child components (like PDFs)
		this.load();

		// Read file content first
		try {
			this.currentContent = await this.app.vault.read(this.file);
		} catch (err) {
			console.error('NoteEditorOverlay: failed to read file', err);
			await this.close();
			return false;
		}
		if (this.isClosed) return false;

		this.buildDOM();

		if (this.mode === 'preview') {
			try {
				await this.renderPreview();
				if (this.isClosed) return false;
			} catch (err) {
				console.error('NoteEditorOverlay: failed to render preview', err);
				await this.close();
				return false;
			}
		}

		this.registerDomEvent(activeDocument, 'keydown', this.keydownHandler);
		return true;
	}

	private async renderPreview(): Promise<boolean> {
		if (this.isClosed) return false;
		const generation = ++this.previewGeneration;
		const nextComponent = this.addChild(new Component());
		const renderTarget = activeDocument.createElement('div');
		try {
			await MarkdownRenderer.render(
				this.app,
				this.currentContent,
				renderTarget,
				this.file.path,
				nextComponent
			);
		} catch (error) {
			this.removeChild(nextComponent);
			throw error;
		}
		if (this.isClosed || this.mode !== 'preview' || generation !== this.previewGeneration) {
			this.removeChild(nextComponent);
			return false;
		}

		this.previewEl!.empty();
		this.previewEl!.append(...Array.from(renderTarget.childNodes));
		const previousComponent = this.previewRenderComponent;
		this.previewRenderComponent = nextComponent;
		if (previousComponent) this.removeChild(previousComponent);
		return true;
	}

	private buildDOM() {
		// --- Backdrop ---
		this.backdropEl = this.mountEl.createDiv({ cls: 'neo-backdrop' });
		this.backdropEl.addEventListener('mousedown', (e) => {
			if (e.target === this.backdropEl) void this.close();
		});

		// --- Overlay panel ---
		this.overlayEl = this.backdropEl.createDiv({ cls: 'neo-panel' });

		// Prevent backdrop click when clicking inside panel
		this.overlayEl.addEventListener('mousedown', (e) => e.stopPropagation());

		this.buildHeader();
		this.buildBody();

		// Animate in
		window.requestAnimationFrame(() => {
			this.backdropEl?.addClass('neo-visible');
		});

		// If edit mode was default, we'd focus it here, but we default to preview
		if (this.mode === 'edit') {
			window.setTimeout(() => this.textareaEl?.focus(), 60);
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
			void this.toggleMode(modeBtn);
		});

		// Open in tab button
		const openBtn = actions.createDiv({ cls: 'neo-btn', attr: { 'aria-label': 'Open in tab' } });
		setIcon(openBtn, 'external-link');
		openBtn.addEventListener('click', () => {
			void (async () => {
				await this.saveNow();
				await openFileInNewTab(this.app, this.file);
				await this.close();
			})();
		});

		// Close button
		const closeBtn = actions.createDiv({ cls: 'neo-btn neo-btn-close', attr: { 'aria-label': 'Close' } });
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => void this.close());
	}

	private buildBody() {
		const body = this.overlayEl!.createDiv({ cls: 'neo-body' });

		// --- Textarea (edit mode) ---
		this.textareaEl = body.createEl('textarea', { cls: 'neo-textarea' });
		this.textareaEl.value = this.currentContent;
		this.textareaEl.spellcheck = false;
		this.textareaEl.setAttribute('placeholder', 'Start writing...');
		this.textareaEl.addClass('neo-hidden');

		this.textareaEl.addEventListener('input', () => {
			this.currentContent = this.textareaEl!.value;
			this.scheduleSave();
		});

		// --- Preview container (preview mode) ---
		this.previewEl = body.createDiv({ cls: 'neo-preview markdown-rendered' });

		// Sync checkbox toggles in preview mode back to the source content
		this.previewEl.addEventListener('click', (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox' && target.classList.contains('task-list-item-checkbox')) {

				window.setTimeout(() => {
					if (this.isClosed) return;
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

		// Right-click: offer "Copy" for selected text and "Open in default browser" for links,
		// since this bespoke preview div isn't a real Obsidian view and gets no native handling.
		this.previewEl.addEventListener('contextmenu', (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			const anchor = target.closest('a');
			const isExternal = !!anchor?.classList.contains('external-link');
			const selection = activeWindow.getSelection()?.toString() ?? '';

			if (!(anchor && isExternal) && !selection) return;

			e.preventDefault();
			const menu = new Menu();

			if (anchor && isExternal) {
				const href = anchor.href;
				menu.addItem((item) => item
					.setTitle('Open in default browser')
					.setIcon('external-link')
					.onClick(() => window.open(href, '_blank')));
				menu.addItem((item) => item
					.setTitle('Copy link')
					.setIcon('link')
					.onClick(() => navigator.clipboard.writeText(href)));
				this.app.workspace.trigger('url-menu', menu, href);
				if (selection) menu.addSeparator();
			}

			if (selection) {
				menu.addItem((item) => item
					.setTitle('Copy')
					.setIcon('copy')
					.onClick(() => navigator.clipboard.writeText(selection)));
			}

			menu.showAtMouseEvent(e);
		});
	}

	private async toggleMode(modeBtn: HTMLElement) {
		if (this.isClosed) return;
		if (this.mode === 'edit') {
			// Switch to preview
			this.mode = 'preview';
			setIcon(modeBtn, 'pencil');
			modeBtn.setAttribute('aria-label', 'Switch to edit');
			this.textareaEl!.addClass('neo-hidden');
			this.previewEl!.removeClass('neo-hidden');
			this.previewEl!.empty();
			await this.renderPreview();
		} else {
			// Switch to edit
			this.mode = 'edit';
			this.previewGeneration++;
			setIcon(modeBtn, 'eye');
			modeBtn.setAttribute('aria-label', 'Toggle preview');
			this.previewEl!.addClass('neo-hidden');
			this.previewEl!.empty();
			if (this.previewRenderComponent) {
				this.removeChild(this.previewRenderComponent);
				this.previewRenderComponent = null;
			}
			this.textareaEl!.removeClass('neo-hidden');
			this.textareaEl!.focus();
		}
	}

	private scheduleSave() {
		if (this.isClosed) return;
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

	close(): Promise<void> {
		if (!this.closePromise) this.closePromise = this.performClose();
		return this.closePromise;
	}

	private async performClose() {
		this.isClosed = true;
		this.previewGeneration++;

		// Save any pending changes before closing
		if (this.isDirty) {
			if (this.autoSaveTimer !== null) {
				window.clearTimeout(this.autoSaveTimer);
				this.autoSaveTimer = null;
			}
			await this.saveNow();
		}

		if (this.autoSaveTimer !== null) {
			window.clearTimeout(this.autoSaveTimer);
			this.autoSaveTimer = null;
		}

		// Animate out then remove
		if (this.backdropEl) {
			this.backdropEl.removeClass('neo-visible');
			window.setTimeout(() => {
				this.backdropEl?.remove();
				this.backdropEl = null;
				this.overlayEl = null;
			}, 200);
		}

		this.unload();
		this.previewRenderComponent = null;
		this.onDidClose?.();
	}
}
