import React from "react";
import { SectionProps, RamenPluginSettings } from "../types";
import { SettingRow } from "../components";
import { t } from "../../i18n";

export function AppearanceSection({ settings, save }: SectionProps) {
	const locale = settings.language;
	return (
		<div>
			<SettingRow
				name={t(locale, "settingsThemeColorName")}
				description={t(locale, "settingsThemeColorDesc")}
				control={
					<select
						value={settings.themeColor}
						onChange={(e) =>
							void save({
								themeColor: e.target
									.value as RamenPluginSettings["themeColor"],
							})
						}
					>
						<option value="system">
							{t(locale, "settingsThemeFollowObsidian")}
						</option>
						<option value="dark">{t(locale, "settingsThemeDark")}</option>
						<option value="light">{t(locale, "settingsThemeLight")}</option>
					</select>
				}
			/>
			<SettingRow
				name={t(locale, "settingsAttachmentLocationName")}
				description={t(locale, "settingsAttachmentLocationDesc")}
				control={
					<select
						value={settings.attachmentLocation}
						onChange={(e) =>
							void save({
								attachmentLocation: e.target
									.value as RamenPluginSettings["attachmentLocation"],
							})
						}
					>
						<option value="bottom">
							{t(locale, "settingsAttachmentLocationBottom")}
						</option>
						<option value="top">
							{t(locale, "settingsAttachmentLocationTop")}
						</option>
					</select>
				}
			/>
			<SettingRow
				name={t(locale, "settingsHideAttachmentFolderName")}
				description={t(locale, "settingsHideAttachmentFolderDesc")}
				control={
					<div
						className={`checkbox-container${settings.hideAttachmentFolder ? " is-enabled" : ""}`}
						onClick={() =>
							void save({
								hideAttachmentFolder:
									!settings.hideAttachmentFolder,
							})
						}
					>
						<input
							type="checkbox"
							readOnly
							checked={settings.hideAttachmentFolder}
						/>
					</div>
				}
			/>
		</div>
	);
}
