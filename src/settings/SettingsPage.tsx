import React, { useEffect, useRef, useState } from "react";
import { setIcon } from "obsidian";
import { RamenPluginSettings } from "./types";
import RamenPlugin from "../main";
import { BlogsSection } from "./blogs/BlogsSection";
import { AppearanceSection } from "./appearance/AppearanceSection";
import { GeneralSection } from "./general/GeneralSection";
import { t } from "../i18n";

type Section = "blogs" | "appearance" | "general";

const SECTION_ICONS: Record<Section, string> = {
	blogs: "rss",
	appearance: "palette",
	general: "settings-2",
};

const SECTION_LABEL_KEYS: Record<
	Section,
	"settingsNavBlogs" | "settingsNavAppearance" | "settingsNavGeneral"
> = {
	blogs: "settingsNavBlogs",
	appearance: "settingsNavAppearance",
	general: "settingsNavGeneral",
};

function NavIcon({ id }: { id: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, id);
	}, [id]);
	return <span ref={ref} className="ramen-nav-icon" />;
}

export function SettingsPage({ plugin }: { plugin: RamenPlugin }) {
	const [active, setActive] = useState<Section>("blogs");
	const [settings, setSettings] = useState<RamenPluginSettings>({
		...plugin.settings,
	});

	const save = async (patch: Partial<RamenPluginSettings>) => {
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
		if ("language" in patch) {
			plugin.updateCommandNames();
		}
	};

	const sections: Section[] = ["blogs", "general", "appearance"];

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
						<span>{t(settings.language, SECTION_LABEL_KEYS[s])}</span>
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
						plugin={plugin}
					/>
				)}
			</div>
		</div>
	);
}
