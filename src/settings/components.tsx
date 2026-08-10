import React, { useEffect, useRef, useState } from "react";
import { App, Menu, setIcon, TFolder } from "obsidian";

export interface IconDropdownOption<T extends string> {
	value: T;
	label: string;
	/** lucide 아이콘 id. */
	icon: string;
}

/**
 * 네이티브 <select>는 옵션 안에 아이콘을 넣을 수 없어서, Obsidian이 Bases 등에서 쓰는 실제
 * "콤보박스 버튼"(.combobox-button/-icon/-label/-chevron) 클래스를 그대로 재현 — <select>와
 * 높이·패딩이 똑같이 맞고, 클릭하면 아이콘이 달린 진짜 Menu가 뜬다.
 */
export function IconDropdown<T extends string>({
	value,
	options,
	onChange,
}: {
	value: T;
	options: IconDropdownOption<T>[];
	onChange: (value: T) => void;
}) {
	const buttonRef = useRef<HTMLButtonElement>(null);
	const chevronRef = useRef<HTMLSpanElement>(null);
	// options는 항상 최소 1개 이상 채워서 호출한다는 전제(호출부가 다 리터럴 배열) — noUncheckedIndexedAccess
	// 때문에 options[0]도 타입상 undefined 가능이라 명시적으로 단언.
	const current = options.find((o) => o.value === value) ?? options[0]!;

	useEffect(() => {
		// 네이티브 <select>/.dropdown이 쓰는 실제 화살표(위+아래 꺾쇠 둘 다)와 맞춤 — chevron-down만
		// 쓰면 다른 방향으로 열 수 있다는 힌트가 없어서 select와 다르게 보임.
		if (chevronRef.current) setIcon(chevronRef.current, "chevrons-up-down");
	}, []);

	const openMenu = () => {
		const menu = new Menu();
		for (const opt of options) {
			menu.addItem((item) =>
				item
					.setTitle(opt.label)
					.setIcon(opt.icon)
					.setChecked(opt.value === value)
					.onClick(() => onChange(opt.value)),
			);
		}
		const rect = buttonRef.current?.getBoundingClientRect();
		if (rect) {
			menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
		}
	};

	return (
		<button
			ref={buttonRef}
			type="button"
			className="combobox-button"
			onClick={openMenu}
		>
			<span className="combobox-button-label">{current.label}</span>
			<span ref={chevronRef} className="combobox-button-chevron" />
		</button>
	);
}

/**
 * Obsidian의 실제 SettingGroup(선언형 설정 API)이 만드는 DOM을 그대로 재현: 소제목은 카드 배경/테두리를
 * 가진 .setting-items 안이 아니라 .setting-group 바로 아래, .setting-items의 형제로 prepend됨
 * (core 소스의 setHeading: `this.groupEl.prepend(this.headerEl)` 참고). .setting-group과 완전히
 * 분리해서 앞에 두면 그룹 사이 여백(.setting-group + .setting-group)이 안 먹어서 위쪽 패딩이 어긋났었음.
 */
export function SettingGroup({
	heading,
	children,
}: {
	heading?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="setting-group">
			{heading && (
				<div className="setting-item setting-item-heading">
					<div className="setting-item-info">
						<div className="setting-item-name">{heading}</div>
					</div>
				</div>
			)}
			<div className="setting-items">{children}</div>
		</div>
	);
}

export function SettingRow({
	name,
	description,
	control,
	className,
}: {
	/** 생략하면 이름/설명 칸(.setting-item-info) 자체를 안 그림 — 버튼만 있는 행 등에 사용. */
	name?: string;
	description?: string;
	control: React.ReactNode;
	/** 이 행에만 추가로 붙일 클래스 (예: SettingGroup 안에서 위 구분선 없애기 등). */
	className?: string;
}) {
	return (
		<div className={`setting-item${className ? ` ${className}` : ""}`}>
			{name && (
				<div className="setting-item-info">
					<div className="setting-item-name">{name}</div>
					{description && (
						<div className="setting-item-description">
							{description}
						</div>
					)}
				</div>
			)}
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
