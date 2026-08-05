import React from "react";
import { SectionProps, RamenPluginSettings } from "../types";
import { SettingRow } from "../components";
import { t } from "../../i18n";

export function GeneralSection({ settings, save }: SectionProps) {
	const locale = settings.language;
	return (
		<div>
			<SettingRow
				name={t(locale, "settingsLanguageName")}
				description={t(locale, "settingsLanguageDesc")}
				control={
					<select
						value={settings.language}
						onChange={(e) =>
							void save({
								language: e.target
									.value as RamenPluginSettings["language"],
							})
						}
					>
						<option value="ko">한국어</option>
						<option value="en">English</option>
					</select>
				}
			/>
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
		</div>
	);
}
