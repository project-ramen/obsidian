import React, { useEffect, useRef, useState } from "react";
import { App, requestUrl, setIcon, TFolder } from "obsidian";
import { BlogConfig, SectionProps } from "../types";
import { FolderInput, IconDropdown, SettingGroup, SettingRow } from "../components";
import { normalizeBlogUrl, persistBlogConnection } from "./blog";
import { Locale, t } from "../../i18n";
import { resolveFixedAttachmentDir } from "../../attachmentFolder";
import { ConfirmModal } from "../../ConfirmModal";

type ConnectStatus = "idle" | "ok" | "error";
type DotColor = "yellow" | "green" | "red";

function statusDotColor(status: ConnectStatus): DotColor {
	if (status === "ok") return "green";
	if (status === "error") return "red";
	return "yellow";
}

function BlogItem({
	blog,
	app,
	locale,
	expanded,
	onToggle,
	onUpdate,
	onDelete,
	isDragOver,
	onDragHandleDragStart,
	onDragHandleDragEnd,
	onItemDragOver,
	onItemDragLeave,
	onItemDrop,
}: {
	blog: BlogConfig;
	app: App;
	locale: Locale;
	expanded: boolean;
	onToggle: () => void;
	onUpdate: (patch: Partial<Omit<BlogConfig, "id">>) => void;
	onDelete: () => void;
	isDragOver: boolean;
	onDragHandleDragStart: (e: React.DragEvent<HTMLSpanElement>) => void;
	onDragHandleDragEnd: () => void;
	onItemDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
	onItemDragLeave: () => void;
	onItemDrop: (e: React.DragEvent<HTMLDivElement>) => void;
}) {
	const [connecting, setConnecting] = useState(false);
	const [status, setStatus] = useState<ConnectStatus>(
		blog.connectedAt ? "ok" : "idle",
	);
	// "연결됨" 배지만 1초 후 사라지게 하는 용도 — status 자체를 되돌리면 헤더의 상태 점(dot)까지
	// 다시 노란색으로 꺼져버려서 분리함. 실패 메시지는 status === "error"로 그대로 계속 표시.
	const [showConnectedMsg, setShowConnectedMsg] = useState(false);
	const [projectTag, setProjectTag] = useState(blog.projectTag ?? "");
	// 디바운스 대기 중이거나 실제 요청이 나가있는 동안 둘 다 true — 인풋 옆 로딩 아이콘 표시 기준.
	const [tagPending, setTagPending] = useState(false);
	const [tagStatus, setTagStatus] = useState<ConnectStatus>("idle");
	const tagDebounceRef = useRef<number | null>(null);

	useEffect(() => {
		if (!expanded || !blog.link) return;
		let cancelled = false;
		const base = normalizeBlogUrl(blog.link);
		requestUrl({
			url: `${base}/api/settings/project-tag`,
			method: "GET",
			throw: false,
		})
			.then((res) => {
				if (cancelled || res.status < 200 || res.status >= 300) return;
				const value = (res.json as { value?: string })?.value ?? "";
				setProjectTag(value);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [expanded, blog.link]);

	useEffect(() => () => {
		if (tagDebounceRef.current) window.clearTimeout(tagDebounceRef.current);
	}, []);

	// "저장됨" 배지 1초 후 자동으로 사라짐 — "저장 실패"는 그대로 남김.
	useEffect(() => {
		if (tagStatus !== "ok") return;
		const timer = window.setTimeout(() => setTagStatus("idle"), 1000);
		return () => window.clearTimeout(timer);
	}, [tagStatus]);

	// "연결됨" 배지 1초 후 자동으로 사라짐.
	useEffect(() => {
		if (!showConnectedMsg) return;
		const timer = window.setTimeout(() => setShowConnectedMsg(false), 1000);
		return () => window.clearTimeout(timer);
	}, [showConnectedMsg]);

	const saveProjectTag = async (value: string) => {
		if (!blog.link || !blog.password) {
			setTagPending(false);
			return;
		}
		try {
			const base = normalizeBlogUrl(blog.link);
			const res = await requestUrl({
				url: `${base}/api/settings/project-tag`,
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${blog.password}`,
				},
				body: JSON.stringify({ value }),
				throw: false,
			});
			if (res.status >= 200 && res.status < 300) {
				setTagStatus("ok");
				onUpdate({ projectTag: value });
			} else {
				setTagStatus("error");
			}
		} catch {
			setTagStatus("error");
		} finally {
			setTagPending(false);
		}
	};

	const handleProjectTagChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setProjectTag(value);
		setTagStatus("idle");
		setTagPending(true);
		if (tagDebounceRef.current) window.clearTimeout(tagDebounceRef.current);
		tagDebounceRef.current = window.setTimeout(() => {
			tagDebounceRef.current = null;
			void saveProjectTag(value.trim());
		}, 500);
	};

	const handleConnect = async () => {
		if (!blog.link) return;
		setConnecting(true);
		setStatus("idle");
		setShowConnectedMsg(false);
		try {
			const base = normalizeBlogUrl(blog.link);
			const res = await requestUrl({
				url: `${base}/api/posts`,
				method: "GET",
				headers: blog.password
					? { Authorization: `Bearer ${blog.password}` }
					: {},
			});
			if (res.status >= 200 && res.status < 300) {
				setStatus("ok");
				setShowConnectedMsg(true);
				persistBlogConnection(blog.rootFolder, base, blog.password);
				onUpdate({ link: base, connectedAt: new Date().toISOString() });
			} else {
				setStatus("error");
			}
		} catch {
			setStatus("error");
		} finally {
			setConnecting(false);
		}
	};

	/**
	 * 첨부파일 폴더 설정(모드 전환 또는 custom 이름 변경)이 바뀌면, 이전에 그 폴더에 저장돼 있던
	 * 파일들을 새 위치로 옮길지 물어봄 — 안 옮기면 기존 파일은 그 자리에 남고 새로 pull되는 파일만
	 * 새 위치에 쌓임. 이전/이후 둘 다 "고정된 폴더 하나"로 특정 가능할 때만(예: default 모드인데
	 * Obsidian 전역 설정이 vault 루트/노트별 하위폴더처럼 파일마다 달라지면 이동 대상을 못 정하므로 스킵) 물어봄.
	 */
	const handleAttachmentFolderChange = (patch: Partial<Pick<BlogConfig, "attachmentFolderMode" | "attachmentFolder">>) => {
		const oldDir = resolveFixedAttachmentDir(app, blog);
		const newDir = resolveFixedAttachmentDir(app, { ...blog, ...patch });

		if (oldDir && newDir && oldDir !== newDir) {
			const oldFolder = app.vault.getAbstractFileByPath(oldDir);
			if (oldFolder instanceof TFolder) {
				new ConfirmModal(
					app,
					t(locale, "confirmMoveAttachmentFolderTitle"),
					t(locale, "confirmMoveAttachmentFolderMessage", { from: oldDir, to: newDir }),
					t(locale, "confirmMoveAttachmentFolderConfirm"),
					t(locale, "confirmMoveAttachmentFolderCancel"),
					(confirmed) => {
						void (async () => {
							if (confirmed) {
								try {
									await app.fileManager.renameFile(oldFolder, newDir);
								} catch (e) {
									console.warn("[ramen] attachment folder move failed", e);
								}
							}
							onUpdate(patch);
						})();
					},
				).open();
				return;
			}
		}
		onUpdate(patch);
	};

	const dotColor = statusDotColor(status);
	const dragHandleRef = useRef<HTMLSpanElement>(null);
	const deleteIconRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (dragHandleRef.current) setIcon(dragHandleRef.current, "grip-vertical");
	}, []);

	useEffect(() => {
		if (deleteIconRef.current) setIcon(deleteIconRef.current, "trash-2");
	}, []);

	return (
		<div
			className={`ramen-blog-item${expanded ? " is-expanded" : ""}${isDragOver ? " is-drag-over" : ""}`}
			onDragOver={onItemDragOver}
			onDragLeave={onItemDragLeave}
			onDrop={onItemDrop}
		>
			<div className="ramen-blog-item-header" onClick={onToggle}>
				<span
					ref={dragHandleRef}
					className="ramen-blog-drag-handle"
					draggable
					title={t(locale, "settingsBlogDragHandle")}
					onClick={(e) => e.stopPropagation()}
					onDragStart={onDragHandleDragStart}
					onDragEnd={onDragHandleDragEnd}
				/>
				<span
					className={`ramen-status-dot ramen-status-dot--${dotColor}`}
				/>
				<span className="ramen-blog-item-name">
					{blog.rootFolder || t(locale, "settingsBlogUntitled")}
				</span>
				<button
					className="ramen-blog-delete-btn"
					title={t(locale, "settingsBlogRemove")}
					onClick={(e) => {
						e.stopPropagation();
						onDelete();
					}}
				>
					<span ref={deleteIconRef} />
				</button>
			</div>

			{expanded && (
				<div className="ramen-blog-item-body">
					<SettingGroup heading={t(locale, "settingsBlogOptions")}>
						<SettingRow
							name={t(locale, "settingsBlogRootFolderName")}
							control={
								<FolderInput
									app={app}
									defaultValue={blog.rootFolder}
									onSave={(v) => onUpdate({ rootFolder: v })}
								/>
							}
						/>
						<SettingRow
							name={t(locale, "settingsBlogLinkName")}
							description={t(locale, "settingsBlogLinkDesc")}
							control={
								<input
									type="text"
									placeholder="https://..."
									defaultValue={blog.link}
									onBlur={(e) => {
										if (e.target.value !== blog.link) {
											setStatus("idle");
											onUpdate({
												link: e.target.value,
												connectedAt: undefined,
											});
										}
									}}
								/>
							}
						/>
						<SettingRow
							name={t(locale, "settingsBlogPasswordName")}
							control={
								<input
									type="password"
									placeholder="••••••••"
									defaultValue={blog.password}
									onBlur={(e) => {
										if (e.target.value !== blog.password) {
											setStatus("idle");
											onUpdate({
												password: e.target.value,
												connectedAt: undefined,
											});
										}
									}}
								/>
							}
						/>
						<SettingRow
							className="ramen-blog-connect-row"
							control={
								<div className="ramen-project-tag-row">
									<button
										className="mod-cta"
										disabled={connecting || !blog.link}
										onClick={() => void handleConnect()}
									>
										{connecting
											? t(locale, "settingsBlogConnecting")
											: t(locale, "settingsBlogConnect")}
									</button>
									{showConnectedMsg && (
										<span className="ramen-connect-status ramen-connect-status--ok">
											{t(locale, "settingsBlogConnected")}
										</span>
									)}
									{status === "error" && (
										<span className="ramen-connect-status ramen-connect-status--error">
											{t(locale, "settingsBlogConnectFailed")}
										</span>
									)}
								</div>
							}
						/>
					</SettingGroup>

					<SettingGroup heading={t(locale, "settingsBlogAdvancedOptions")}>
						<SettingRow
							name={t(locale, "settingsBlogAttachmentFolderName")}
							description={t(locale, "settingsBlogAttachmentFolderDesc")}
							control={
								<IconDropdown
									value={blog.attachmentFolderMode}
									onChange={(mode) => handleAttachmentFolderChange({ attachmentFolderMode: mode })}
									options={[
										{ value: "default", label: t(locale, "settingsBlogAttachmentFolderModeDefault"), icon: "settings-2" },
										{ value: "custom", label: t(locale, "settingsBlogAttachmentFolderModeCustom"), icon: "folder-plus" },
									]}
								/>
							}
						/>
						{blog.attachmentFolderMode === "custom" && (
							<SettingRow
								description={t(locale, "settingsBlogAttachmentFolderCustomDesc")}
								control={
									<input
										type="text"
										placeholder="attachments"
										defaultValue={blog.attachmentFolder}
										onBlur={(e) => {
											if (
												e.target.value !== blog.attachmentFolder
											) {
												handleAttachmentFolderChange({
													attachmentFolder: e.target.value,
												});
											}
										}}
									/>
								}
							/>
						)}
						<SettingRow
							name={t(locale, "settingsBlogProjectTagName")}
							description={t(locale, "settingsBlogProjectTagDesc")}
							control={
								<div className="ramen-project-tag-row">
									<div className="ramen-input-with-spinner">
										<input
											type="text"
											placeholder="project"
											value={projectTag}
											disabled={!blog.link || !blog.password}
											onChange={handleProjectTagChange}
										/>
										{tagPending && (
											<span className="ramen-input-spinner" aria-hidden="true" />
										)}
									</div>
									{!tagPending && tagStatus === "ok" && (
										<span className="ramen-connect-status ramen-connect-status--ok">
											{t(locale, "settingsBlogSaved")}
										</span>
									)}
									{!tagPending && tagStatus === "error" && (
										<span className="ramen-connect-status ramen-connect-status--error">
											{t(locale, "settingsBlogSaveFailed")}
										</span>
									)}
								</div>
							}
						/>
					</SettingGroup>
				</div>
			)}
		</div>
	);
}

export function BlogsSection({ settings, save, app }: SectionProps) {
	const locale = settings.language;
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [overIndex, setOverIndex] = useState<number | null>(null);

	const reorderBlogs = (from: number, to: number) => {
		if (from === to) return;
		const next = [...settings.blogs];
		const [moved] = next.splice(from, 1);
		if (!moved) return;
		next.splice(to, 0, moved);
		void save({ blogs: next });
	};

	const addBlog = () => {
		const id = crypto.randomUUID();
		const newBlog: BlogConfig = {
			id,
			rootFolder: "",
			link: "",
			password: "",
			attachmentFolderMode: "custom",
			attachmentFolder: "attachments",
			projectTag: "",
		};
		void save({ blogs: [...settings.blogs, newBlog] });
		setExpandedId(id);
	};

	const updateBlog = (id: string, patch: Partial<Omit<BlogConfig, "id">>) => {
		void save({
			blogs: settings.blogs.map((b) =>
				b.id === id ? { ...b, ...patch } : b,
			),
		});
	};

	const deleteBlog = (id: string) => {
		if (expandedId === id) setExpandedId(null);
		void save({ blogs: settings.blogs.filter((b) => b.id !== id) });
	};

	return (
		<div className="ramen-blogs-list">
			{settings.blogs.length === 0 && (
				<p className="ramen-blogs-empty">
					{t(locale, "settingsBlogsEmpty")}
				</p>
			)}
			{settings.blogs.map((blog, index) => (
				<BlogItem
					key={blog.id}
					blog={blog}
					app={app}
					locale={locale}
					expanded={expandedId === blog.id}
					onToggle={() =>
						setExpandedId(expandedId === blog.id ? null : blog.id)
					}
					onUpdate={(patch) => updateBlog(blog.id, patch)}
					onDelete={() => deleteBlog(blog.id)}
					isDragOver={overIndex === index && dragIndex !== null && dragIndex !== index}
					onDragHandleDragStart={(e) => {
						setDragIndex(index);
						e.dataTransfer.effectAllowed = "move";
						e.dataTransfer.setData("text/plain", blog.id);
					}}
					onDragHandleDragEnd={() => {
						setDragIndex(null);
						setOverIndex(null);
					}}
					onItemDragOver={(e) => {
						if (dragIndex === null) return;
						e.preventDefault();
						e.dataTransfer.dropEffect = "move";
						setOverIndex(index);
					}}
					onItemDragLeave={() =>
						setOverIndex((cur) => (cur === index ? null : cur))
					}
					onItemDrop={(e) => {
						e.preventDefault();
						if (dragIndex !== null) reorderBlogs(dragIndex, index);
						setDragIndex(null);
						setOverIndex(null);
					}}
				/>
			))}
			<button className="ramen-blogs-add-btn" onClick={addBlog}>
				{t(locale, "settingsBlogsAdd")}
			</button>
		</div>
	);
}
