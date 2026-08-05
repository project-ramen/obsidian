import React, { useEffect, useRef, useState } from "react";
import { App, TFolder } from "obsidian";

export function SettingRow({
	name,
	description,
	control,
}: {
	name: string;
	description?: string;
	control: React.ReactNode;
}) {
	return (
		<div className="setting-item">
			<div className="setting-item-info">
				<div className="setting-item-name">{name}</div>
				{description && (
					<div className="setting-item-description">
						{description}
					</div>
				)}
			</div>
			<div className="setting-item-control">{control}</div>
		</div>
	);
}

export function FolderInput({
	app,
	defaultValue,
	onSave,
}: {
	app: App;
	defaultValue: string;
	onSave: (value: string) => void;
}) {
	const [value, setValue] = useState(defaultValue);
	const [suggestions, setSuggestions] = useState<string[]>([]);
	const [open, setOpen] = useState(false);
	const wrapperRef = useRef<HTMLDivElement>(null);

	const allFolders: string[] = app.vault
		.getAllFolders(false)
		.map((f: TFolder) => f.path)
		.sort();

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const q = e.target.value;
		setValue(q);
		setSuggestions(
			q.trim() === ""
				? allFolders.slice(0, 20)
				: allFolders
						.filter((p) =>
							p.toLowerCase().includes(q.toLowerCase()),
						)
						.slice(0, 20),
		);
		setOpen(true);
	};

	const handleFocus = () => {
		setSuggestions(
			value.trim() === ""
				? allFolders.slice(0, 20)
				: allFolders
						.filter((p) =>
							p.toLowerCase().includes(value.toLowerCase()),
						)
						.slice(0, 20),
		);
		setOpen(true);
	};

	const handleSelect = (path: string) => {
		setValue(path);
		setOpen(false);
		onSave(path);
	};

	const handleBlur = () => {
		window.setTimeout(() => setOpen(false), 150);
		onSave(value);
	};

	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (
				wrapperRef.current &&
				!wrapperRef.current.contains(e.target as Node)
			) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

	return (
		<div ref={wrapperRef} className="ramen-folder-wrapper">
			<input
				type="text"
				placeholder="/path/to/folder"
				value={value}
				onChange={handleChange}
				onFocus={handleFocus}
				onBlur={handleBlur}
				onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
			/>
			{open && suggestions.length > 0 && (
				<ul className="ramen-folder-suggestions">
					{suggestions.map((path) => (
						<li
							key={path}
							className="ramen-folder-suggestion-item"
							onMouseDown={() => handleSelect(path)}
						>
							{path}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
