import { App, MarkdownView, Modal, TFile, normalizePath, setIcon } from 'obsidian';
import RamenPlugin from './main';

interface ImageItem {
	file: TFile;
	line: number;
	original: string; // exact embed text e.g. "![[photo.png]]"
}

class DeleteConfirmModal extends Modal {
	constructor(app: App, private onConfirm: () => void | Promise<void>) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText('Delete attachment?');
		this.contentEl.createEl('p', {
			text: 'This will remove the embed from the file. The image file itself will not be deleted.',
		});

		const btnRow = this.contentEl.createDiv({ cls: 'modal-button-container' });

		const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		const confirmBtn = btnRow.createEl('button', { text: 'Delete', cls: 'mod-warning' });
		confirmBtn.addEventListener('click', () => {
			void this.onConfirm();
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class AttachmentPreviewManager {
	private popup: HTMLElement | null = null;

	constructor(private plugin: RamenPlugin) {}

	register() {
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-open', (file) => {
				if (file) window.setTimeout(() => this.renderStrip(file), 100);
			})
		);

		// Re-render when the active file's embeds change (e.g. after Insert Image)
		this.plugin.registerEvent(
			this.plugin.app.metadataCache.on('changed', (file) => {
				const activeFile = this.plugin.app.workspace.getActiveFile();
				if (activeFile && file.path === activeFile.path) {
					window.setTimeout(() => this.renderStrip(file), 100);
				}
			})
		);

		this.plugin.app.workspace.onLayoutReady(() => {
			const file = this.plugin.app.workspace.getActiveFile();
			if (file) window.setTimeout(() => this.renderStrip(file), 100);
		});
	}

	refresh() {
		const file = this.plugin.app.workspace.getActiveFile();
		if (file) this.renderStrip(file);
	}

	private getOrCreatePopup(): HTMLElement {
		if (!this.popup) {
			this.popup = document.body.createDiv({ cls: 'ramen-image-popup' });
			this.popup.createEl('img');
		}
		return this.popup;
	}

	private showPopup(src: string, anchor: HTMLElement) {
		const popup = this.getOrCreatePopup();
		(popup.querySelector('img') as HTMLImageElement).src = src;
		popup.addClass('is-visible');

		const rect = anchor.getBoundingClientRect();
		const popupH = 260;
		const popupW = 360;
		const top = rect.top > popupH + 12 ? rect.top - popupH - 8 : rect.bottom + 8;
		const left = Math.min(rect.left, window.innerWidth - popupW - 12);
		popup.style.top = `${top}px`;
		popup.style.left = `${Math.max(8, left)}px`;
	}

	private hidePopup() {
		if (this.popup) this.popup.removeClass('is-visible');
	}

	private async deleteEmbed(noteFile: TFile, item: ImageItem) {
		const content = await this.plugin.app.vault.read(noteFile);
		const lines = content.split('\n');
		const lineIndex = item.line;
		const line = lines[lineIndex];
		if (line === undefined) return;

		// Remove the exact embed text from that line
		lines[lineIndex] = line.replace(item.original, '').trim();

		// Drop the line entirely if it's now empty
		if (lines[lineIndex] === '') lines.splice(lineIndex, 1);

		await this.plugin.app.vault.modify(noteFile, lines.join('\n'));
	}

	private renderStrip(noteFile: TFile) {
		const { blogs, attachmentLocation } = this.plugin.settings;

		document.querySelectorAll('.ramen-attachment-strip').forEach((el) => el.remove());

		const normalizedPath = normalizePath(noteFile.path);
		const matchingBlog = blogs.find((b) => {
			if (!b.rootFolder) return false;
			const root = normalizePath(b.rootFolder);
			return normalizedPath === root || normalizedPath.startsWith(root + '/');
		});
		if (!matchingBlog) return;

		const cache = this.plugin.app.metadataCache.getFileCache(noteFile);
		const embeds = cache?.embeds ?? [];
		const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);

		const seen = new Set<string>();
		const imageItems: ImageItem[] = [];

		for (const embed of embeds) {
			const ext = embed.link.split('.').pop()?.toLowerCase() ?? '';
			if (!imageExts.has(ext)) continue;
			const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(embed.link, noteFile.path);
			if (!(resolved instanceof TFile)) continue;
			if (seen.has(resolved.path)) continue;
			seen.add(resolved.path);
			imageItems.push({
				file: resolved,
				line: embed.position.start.line,
				original: embed.original ?? `![[${embed.link}]]`,
			});
		}

		if (imageItems.length === 0) return;

		const leaves = this.plugin.app.workspace.getLeavesOfType('markdown');
		const targetLeaf = leaves.find((l) => (l.view as MarkdownView).file?.path === noteFile.path);
		if (!targetLeaf) return;
		const view = targetLeaf.view as MarkdownView;

		const anchor = view.containerEl.querySelector('.cm-contentContainer');
		if (!anchor) return;

		const strip = createDiv({ cls: `ramen-attachment-strip location-${attachmentLocation}` });
		strip.createSpan({ cls: 'ramen-strip-label', text: 'Attachments' });
		const itemsRow = strip.createDiv({ cls: 'ramen-strip-items' });

		for (const item of imageItems) {
			const wrapper = itemsRow.createDiv({ cls: 'ramen-strip-item' });

			const img = wrapper.createEl('img');
			img.src = this.plugin.app.vault.getResourcePath(item.file);
			img.alt = item.file.name;

			img.addEventListener('mouseenter', () => this.showPopup(img.src, img));
			img.addEventListener('mouseleave', () => this.hidePopup());
			img.addEventListener('click', () => {
				const { line } = item;
				view.editor.setCursor({ line, ch: 0 });
				view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
			});

			// Trash button — shown on hover via CSS
			const deleteBtn = wrapper.createEl('button', { cls: 'ramen-strip-delete-btn' });
			setIcon(deleteBtn, 'trash-2');
			deleteBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.hidePopup();
				new DeleteConfirmModal(this.plugin.app, async () => {
					await this.deleteEmbed(noteFile, item);
					window.setTimeout(() => this.renderStrip(noteFile), 100);
				}).open();
			});
		}

		if (attachmentLocation === 'top') {
			anchor.before(strip);
		} else {
			anchor.after(strip);
		}
	}

	unload() {
		document.querySelectorAll('.ramen-attachment-strip').forEach((el) => el.remove());
		this.popup?.remove();
		this.popup = null;
	}
}
