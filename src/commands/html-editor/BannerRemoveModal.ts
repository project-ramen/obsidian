import { App, Modal } from 'obsidian';

export type BannerRemoveChoice = 'delete-file' | 'unlink-only';

/** "배너 삭제" 눌렀을 때: frontmatter 참조만 지울지, vault의 실제 이미지 파일까지 지울지 물어봄.
 *  Esc/바깥 클릭으로 닫으면 취소(null)로 취급 — ConfirmModal과 같은 관례. */
export class BannerRemoveModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private labels: {
			title: string;
			message: string;
			deleteFileLabel: string;
			unlinkOnlyLabel: string;
			cancelLabel: string;
		},
		private onResult: (choice: BannerRemoveChoice | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.labels.title);
		this.contentEl.createEl('p', { text: this.labels.message });

		const buttons = this.contentEl.createDiv({ cls: 'ramen-confirm-modal-buttons' });
		const cancelBtn = buttons.createEl('button', { text: this.labels.cancelLabel });
		cancelBtn.addEventListener('click', () => {
			this.resolved = true;
			this.onResult(null);
			this.close();
		});
		const unlinkBtn = buttons.createEl('button', { text: this.labels.unlinkOnlyLabel });
		unlinkBtn.addEventListener('click', () => {
			this.resolved = true;
			this.onResult('unlink-only');
			this.close();
		});
		const deleteBtn = buttons.createEl('button', { text: this.labels.deleteFileLabel, cls: 'mod-warning' });
		deleteBtn.addEventListener('click', () => {
			this.resolved = true;
			this.onResult('delete-file');
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) this.onResult(null);
	}
}
