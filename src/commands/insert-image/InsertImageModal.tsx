import React, { useMemo, useRef, useState } from 'react';
import { App, Editor, Modal, TFile } from 'obsidian';
import { createRoot, Root } from 'react-dom/client';
import { Locale, t } from '../../i18n';

interface PickerProps {
	app: App;
	imageFiles: TFile[];
	onSelect: (file: TFile) => void;
	locale: Locale;
}

function InsertImagePicker({ app, imageFiles, onSelect, locale }: PickerProps) {
	const [query, setQuery] = useState('');
	const inputRef = useRef<HTMLInputElement>(null);

	const filtered = useMemo(
		() => imageFiles.filter((f) => f.name.toLowerCase().includes(query.toLowerCase())),
		[imageFiles, query]
	);

	return (
		<div className="ramen-insert-image-picker">
			<input
				ref={inputRef}
				className="ramen-insert-image-search"
				type="text"
				placeholder={t(locale, 'insertImageSearchPlaceholder')}
				value={query}
				autoFocus
				onChange={(e) => setQuery(e.target.value)}
			/>

			{filtered.length === 0 ? (
				<div className="ramen-insert-image-empty">{t(locale, 'insertImageNoneFound')}</div>
			) : (
				<div className="ramen-insert-image-grid">
					{filtered.map((file) => (
						<button
							key={file.path}
							className="ramen-insert-image-item"
							onClick={() => onSelect(file)}
							title={file.path}
						>
							<div className="ramen-insert-image-thumb">
								<img
									src={app.vault.getResourcePath(file)}
									alt={file.name}
								/>
							</div>
							<span className="ramen-insert-image-name">{file.name}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

export class InsertImageModal extends Modal {
	private root: Root | null = null;

	constructor(app: App, private editor: Editor, private locale: Locale = 'ko') {
		super(app);
	}

	onOpen() {
		this.titleEl.setText(t(this.locale, 'insertImageTitle'));
		this.modalEl.addClass('ramen-insert-image-modal');

		const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);
		const imageFiles = this.app.vault
			.getFiles()
			.filter((f) => imageExts.has(f.extension.toLowerCase()))
			.sort((a, b) => a.name.localeCompare(b.name));

		this.root = createRoot(this.contentEl);
		this.root.render(
			<InsertImagePicker
				app={this.app}
				imageFiles={imageFiles}
				locale={this.locale}
				onSelect={(file) => {
					this.editor.replaceSelection(`![[${file.name}]]`);
					this.close();
				}}
			/>
		);
	}

	onClose() {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
	}
}
