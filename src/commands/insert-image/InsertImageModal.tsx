import React, { useMemo, useRef, useState } from 'react';
import { App, Editor, Modal, TFile } from 'obsidian';
import { createRoot, Root } from 'react-dom/client';

interface PickerProps {
	app: App;
	imageFiles: TFile[];
	onSelect: (file: TFile) => void;
}

function InsertImagePicker({ app, imageFiles, onSelect }: PickerProps) {
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
				placeholder="Search images…"
				value={query}
				autoFocus
				onChange={(e) => setQuery(e.target.value)}
			/>

			{filtered.length === 0 ? (
				<div className="ramen-insert-image-empty">No images found</div>
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

	constructor(app: App, private editor: Editor) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText('Insert image');
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
