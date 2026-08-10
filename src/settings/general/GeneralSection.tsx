import React, { useState } from "react";
import { SectionProps } from "../types";
import { IconDropdown, SettingGroup, SettingRow } from "../components";
import { t, Locale } from "../../i18n";
import RamenPlugin from "../../main";
import { isNewerVersion } from "../../update-checker";

function UpdateRow({ plugin, locale }: { plugin: RamenPlugin; locale: Locale }) {
	const current = plugin.manifest.version;
	const [checking, setChecking] = useState(false);
	const [installing, setInstalling] = useState(false);
	const [latest, setLatest] = useState<string | null>(plugin.settings.latestKnownVersion ?? null);

	const hasUpdate = !!latest && isNewerVersion(latest, current);

	const handleCheck = async () => {
		setChecking(true);
		try {
			const result = await plugin.checkForUpdates({ force: true });
			setLatest(result.latestVersion);
		} finally {
			setChecking(false);
		}
	};

	const handleInstall = async () => {
		setInstalling(true);
		try {
			await plugin.installUpdate();
		} finally {
			setInstalling(false);
		}
	};

	return (
		<SettingRow
			name={t(locale, "settingsUpdateName")}
			description={
				hasUpdate
					? t(locale, "settingsUpdateAvailableDesc", { current, latest: latest ?? current })
					: t(locale, "settingsUpdateUpToDateDesc", { current })
			}
			control={
				<div className="ramen-update-controls">
					<button disabled={checking} onClick={() => void handleCheck()}>
						{checking ? t(locale, "settingsUpdateChecking") : t(locale, "settingsUpdateCheckNow")}
					</button>
					{hasUpdate && (
						<button
							className="mod-cta"
							disabled={installing}
							onClick={() => void handleInstall()}
						>
							{installing ? t(locale, "settingsUpdateInstalling") : t(locale, "settingsUpdateInstall")}
						</button>
					)}
				</div>
			}
		/>
	);
}

export function GeneralSection({ settings, save, plugin }: SectionProps & { plugin: RamenPlugin }) {
	const locale = settings.language;
	return (
		<div>
			<SettingRow
				name={t(locale, "settingsLanguageName")}
				description={t(locale, "settingsLanguageDesc")}
				control={
					<IconDropdown
						value={settings.language}
						onChange={(v) => void save({ language: v })}
						options={[
							{ value: "ko", label: "한국어", icon: "languages" },
							{ value: "en", label: "English", icon: "languages" },
						]}
					/>
				}
			/>
			<SettingRow
				name={t(locale, "settingsDebugModeName")}
				description={t(locale, "settingsDebugModeDesc")}
				control={
					<div
						className={`checkbox-container${settings.debugMode ? " is-enabled" : ""}`}
						onClick={() =>
							void save({ debugMode: !settings.debugMode })
						}
					>
						<input
							type="checkbox"
							readOnly
							checked={settings.debugMode}
						/>
					</div>
				}
			/>

			<SettingGroup heading={t(locale, "settingsGroupDotfiles")}>
				<SettingRow
					name={t(locale, "settingsShowDotfilesName")}
					description={t(locale, "settingsShowDotfilesDesc")}
					control={
						<div
							className={`checkbox-container${settings.showDotfiles ? " is-enabled" : ""}`}
							onClick={() =>
								void save({ showDotfiles: !settings.showDotfiles })
							}
						>
							<input
								type="checkbox"
								readOnly
								checked={settings.showDotfiles}
							/>
						</div>
					}
				/>
				<SettingRow
					name={t(locale, "settingsDotfilesSyncName")}
					description={t(locale, "settingsDotfilesSyncDesc")}
					control={
						<div
							className={`checkbox-container${settings.dotfilesSync ? " is-enabled" : ""}`}
							onClick={() =>
								void save({ dotfilesSync: !settings.dotfilesSync })
							}
						>
							<input
								type="checkbox"
								readOnly
								checked={settings.dotfilesSync}
							/>
						</div>
					}
				/>
			</SettingGroup>

			<SettingGroup heading={t(locale, "settingsGroupHtmlEditor")}>
				<SettingRow
					name={t(locale, "settingsHtmlEditorAutoSwitchName")}
					description={t(locale, "settingsHtmlEditorAutoSwitchDesc")}
					control={
						<div
							className={`checkbox-container${settings.htmlEditorAutoSwitch ? " is-enabled" : ""}`}
							onClick={() =>
								void save({ htmlEditorAutoSwitch: !settings.htmlEditorAutoSwitch })
							}
						>
							<input
								type="checkbox"
								readOnly
								checked={settings.htmlEditorAutoSwitch}
							/>
						</div>
					}
				/>
				<SettingRow
					name={t(locale, "settingsHtmlEditorDefaultTabName")}
					description={t(locale, "settingsHtmlEditorDefaultTabDesc")}
					control={
						<IconDropdown
							value={settings.htmlEditorDefaultTab}
							onChange={(v) => void save({ htmlEditorDefaultTab: v })}
							options={[
								{ value: "preview", label: t(locale, "htmlEditorTabPreview"), icon: "eye" },
								{ value: "html", label: "HTML", icon: "code" },
								{ value: "css", label: "CSS", icon: "palette" },
								{ value: "js", label: "JS", icon: "braces" },
							]}
						/>
					}
				/>
			</SettingGroup>

			<SettingGroup heading={t(locale, "settingsGroupUpdate")}>
				<SettingRow
					name={t(locale, "settingsAutoUpdateCheckName")}
					description={t(locale, "settingsAutoUpdateCheckDesc")}
					control={
						<div
							className={`checkbox-container${settings.autoUpdateCheck ? " is-enabled" : ""}`}
							onClick={() =>
								void save({ autoUpdateCheck: !settings.autoUpdateCheck })
							}
						>
							<input
								type="checkbox"
								readOnly
								checked={settings.autoUpdateCheck}
							/>
						</div>
					}
				/>
				<UpdateRow plugin={plugin} locale={locale} />
			</SettingGroup>
		</div>
	);
}
