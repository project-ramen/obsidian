import React, { useEffect, useRef, useState } from "react";
import { setIcon } from "obsidian";
import { MyPluginSettings } from "./types";
import MyPlugin from "../main";
import { BlogsSection } from "./blogs/BlogsSection";
import { AppearanceSection } from "./appearance/AppearanceSection";
import { GeneralSection } from "./general/GeneralSection";

type Section = "blogs" | "appearance" | "general";

const SECTION_ICONS: Record<Section, string> = {
	blogs: "rss",
	appearance: "palette",
	general: "settings-2",
};

function NavIcon({ id }: { id: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, id);
	}, [id]);
	return <span ref={ref} className="ramen-nav-icon" />;
}

export function SettingsPage({ plugin }: { plugin: MyPlugin }) {
	const [active, setActive] = useState<Section>("blogs");
	const [settings, setSettings] = useState<MyPluginSettings>({
		...plugin.settings,
	});

	const save = async (patch: Partial<MyPluginSettings>) => {
		Object.assign(plugin.settings, patch);
		await plugin.saveSettings();
		setSettings({ ...plugin.settings });
		if ("attachmentLocation" in patch) {
			plugin.attachmentPreview.refresh();
		}
		if ("hideAttachmentFolder" in patch) {
			plugin.applyAttachmentFolderHiding();
		}
		if ("blogs" in patch) {
			plugin.applyPublishedFileMarkers();
		}
	};

	const sections: Section[] = ["blogs", "appearance", "general"];

	return (
		<div className="ramen-settings-container">
			<nav className="ramen-settings-nav">
				{sections.map((s) => (
					<button
						key={s}
						className={`ramen-settings-nav-btn${active === s ? " active" : ""}`}
						onClick={() => setActive(s)}
					>
						<NavIcon id={SECTION_ICONS[s]} />
						<span>{s.charAt(0).toUpperCase() + s.slice(1)}</span>
					</button>
				))}
			</nav>

			<div className="ramen-settings-content">
				{active === "blogs" && (
					<BlogsSection
						settings={settings}
						save={save}
						app={plugin.app}
					/>
				)}
				{active === "appearance" && (
					<AppearanceSection
						settings={settings}
						save={save}
						app={plugin.app}
					/>
				)}
				{active === "general" && (
					<GeneralSection
						settings={settings}
						save={save}
						app={plugin.app}
					/>
				)}
			</div>
		</div>
	);
}
