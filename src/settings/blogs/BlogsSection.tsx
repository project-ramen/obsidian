import React, { useEffect, useState } from "react";
import { App, requestUrl } from "obsidian";
import { BlogConfig, MyPluginSettings, SectionProps } from "../types";
import { FolderInput, SettingRow } from "../components";
import { normalizeBlogUrl, persistBlogConnection } from "./blog";

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
	expanded,
	onToggle,
	onUpdate,
	onDelete,
}: {
	blog: BlogConfig;
	app: App;
	expanded: boolean;
	onToggle: () => void;
	onUpdate: (patch: Partial<Omit<BlogConfig, "id">>) => void;
	onDelete: () => void;
}) {
	const [connecting, setConnecting] = useState(false);
	const [status, setStatus] = useState<ConnectStatus>(
		blog.connectedAt ? "ok" : "idle",
	);
	const [projectTag, setProjectTag] = useState(blog.projectTag ?? "");
	const [savingTag, setSavingTag] = useState(false);
	const [tagStatus, setTagStatus] = useState<ConnectStatus>("idle");

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

	const handleSaveProjectTag = async () => {
		if (!blog.link || !blog.password) return;
		setSavingTag(true);
		setTagStatus("idle");
		try {
			const base = normalizeBlogUrl(blog.link);
			const value = projectTag.trim();
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
			setSavingTag(false);
		}
	};

	const handleConnect = async () => {
		if (!blog.link) return;
		setConnecting(true);
		setStatus("idle");
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

	const dotColor = statusDotColor(status);

	return (
		<div className={`ramen-blog-item${expanded ? " is-expanded" : ""}`}>
			<div className="ramen-blog-item-header" onClick={onToggle}>
				<span
					className={`ramen-status-dot ramen-status-dot--${dotColor}`}
				/>
				<span className="ramen-blog-item-name">
					{blog.rootFolder || "Untitled blog"}
				</span>
				<button
					className="ramen-blog-delete-btn"
					title="Remove"
					onClick={(e) => {
						e.stopPropagation();
						onDelete();
					}}
				>
					×
				</button>
			</div>

			{expanded && (
				<div className="ramen-blog-item-body">
					<SettingRow
						name="Root folder"
						control={
							<FolderInput
								app={app}
								defaultValue={blog.rootFolder}
								onSave={(v) => onUpdate({ rootFolder: v })}
							/>
						}
					/>
					<SettingRow
						name="Link"
						description="Remote endpoint URL"
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
						name="Password"
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
						name="Attachment folder"
						description="Folder name inside root folder to exclude from sync and hide"
						control={
							<input
								type="text"
								placeholder="attachments"
								defaultValue={blog.attachmentFolder}
								onBlur={(e) => {
									if (
										e.target.value !== blog.attachmentFolder
									) {
										onUpdate({
											attachmentFolder: e.target.value,
										});
									}
								}}
							/>
						}
					/>
					<SettingRow
						name="Project tag"
						description="Posts with this tag show up under /project instead of /post on the blog"
						control={
							<div className="ramen-project-tag-row">
								<input
									type="text"
									placeholder="project"
									value={projectTag}
									onChange={(e) => {
										setProjectTag(e.target.value);
										setTagStatus("idle");
									}}
								/>
								<button
									disabled={
										savingTag || !blog.link || !blog.password
									}
									onClick={handleSaveProjectTag}
								>
									{savingTag ? "Saving…" : "Save"}
								</button>
								{tagStatus === "ok" && (
									<span className="ramen-connect-status ramen-connect-status--ok">
										Saved
									</span>
								)}
								{tagStatus === "error" && (
									<span className="ramen-connect-status ramen-connect-status--error">
										Failed to save
									</span>
								)}
							</div>
						}
					/>
					<div className="ramen-blog-item-footer">
						<button
							className="mod-cta"
							disabled={connecting || !blog.link}
							onClick={handleConnect}
						>
							{connecting ? "Connecting…" : "Connect"}
						</button>
						{status === "ok" && (
							<span className="ramen-connect-status ramen-connect-status--ok">
								Connected
							</span>
						)}
						{status === "error" && (
							<span className="ramen-connect-status ramen-connect-status--error">
								Failed to connect
							</span>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

export function BlogsSection({ settings, save, app }: SectionProps) {
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const addBlog = () => {
		const id = crypto.randomUUID();
		const newBlog: BlogConfig = {
			id,
			rootFolder: "",
			link: "",
			password: "",
			attachmentFolder: "attachments",
			projectTag: "",
		};
		save({ blogs: [...settings.blogs, newBlog] });
		setExpandedId(id);
	};

	const updateBlog = (id: string, patch: Partial<Omit<BlogConfig, "id">>) => {
		save({
			blogs: settings.blogs.map((b) =>
				b.id === id ? { ...b, ...patch } : b,
			),
		});
	};

	const deleteBlog = (id: string) => {
		if (expandedId === id) setExpandedId(null);
		save({ blogs: settings.blogs.filter((b) => b.id !== id) });
	};

	return (
		<div className="ramen-blogs-list">
			{settings.blogs.length === 0 && (
				<p className="ramen-blogs-empty">
					No blogs yet. Add one below.
				</p>
			)}
			{settings.blogs.map((blog) => (
				<BlogItem
					key={blog.id}
					blog={blog}
					app={app}
					expanded={expandedId === blog.id}
					onToggle={() =>
						setExpandedId(expandedId === blog.id ? null : blog.id)
					}
					onUpdate={(patch) => updateBlog(blog.id, patch)}
					onDelete={() => deleteBlog(blog.id)}
				/>
			))}
			<button className="ramen-blogs-add-btn" onClick={addBlog}>
				+ Add blog
			</button>
		</div>
	);
}
