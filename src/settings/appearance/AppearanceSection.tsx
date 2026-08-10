import React from "react";
import { SectionProps } from "../types";
import { IconDropdown, SettingGroup, SettingRow } from "../components";
import { t } from "../../i18n";

export function AppearanceSection({ settings, save }: SectionProps) {
	const locale = settings.language;
	return (
		<div>
			<SettingRow
				name={t(locale, "settingsThemeColorName")}
				description={t(locale, "settingsThemeColorDesc")}
				control={
					<IconDropdown
						value={settings.themeColor}
						onChange={(v) => void save({ themeColor: v })}
						options={[
							{ value: "system", label: t(locale, "settingsThemeFollowObsidian"), icon: "monitor" },
							{ value: "dark", label: t(locale, "settingsThemeDark"), icon: "moon" },
							{ value: "light", label: t(locale, "settingsThemeLight"), icon: "sun" },
						]}
					/>
				}
			/>

			<SettingGroup heading={t(locale, "settingsGroupAttachment")}>
				<SettingRow
					name={t(locale, "settingsAttachmentLocationName")}
					description={t(locale, "settingsAttachmentLocationDesc")}
					control={
						<IconDropdown
							value={settings.attachmentLocation}
							onChange={(v) => void save({ attachmentLocation: v })}
							options={[
								{ value: "bottom", label: t(locale, "settingsAttachmentLocationBottom"), icon: "arrow-down-to-line" },
								{ value: "top", label: t(locale, "settingsAttachmentLocationTop"), icon: "arrow-up-to-line" },
							]}
						/>
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
			</SettingGroup>
		</div>
	);
}
