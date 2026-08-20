import { App, Modal } from 'obsidian';

/** 예/아니오로만 답하면 되는 범용 확인 모달. Esc/바깥 클릭으로 닫으면 취소(false)로 취급. */
export class ConfirmModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private titleText: string,
		private message: string,
		private confirmLabel: string,
		private cancelLabel: string,
		private onResult: (confirmed: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.titleText);
		this.contentEl.createEl('p', { text: this.message });

		const buttons = this.contentEl.createDiv({ cls: 'ramen-confirm-modal-buttons' });
		const cancelBtn = buttons.createEl('button', { text: this.cancelLabel });
		cancelBtn.addEventListener('click', () => {
			this.resolved = true;
			this.onResult(false);
			this.close();
		});
		const confirmBtn = buttons.createEl('button', { text: this.confirmLabel, cls: 'mod-cta' });
		confirmBtn.addEventListener('click', () => {
			this.resolved = true;
			this.onResult(true);
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) this.onResult(false);
	}
}
