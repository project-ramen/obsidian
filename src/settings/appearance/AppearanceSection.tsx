import React from "react";
import { SectionProps, MyPluginSettings } from "../types";
import { SettingRow } from "../components";

export function AppearanceSection({ settings, save }: SectionProps) {
	return (
		<div>
			<SettingRow
				name="Theme color"
				description="Override the app theme or follow Obsidian's setting"
				control={
					<select
						value={settings.themeColor}
						onChange={(e) =>
							save({
								themeColor: e.target
									.value as MyPluginSettings["themeColor"],
							})
						}
					>
						<option value="system">Follow Obsidian</option>
						<option value="dark">Dark</option>
						<option value="light">Light</option>
					</select>
				}
			/>
			<SettingRow
				name="Attachment location"
				description="Where the attachment preview strip appears in file views"
				control={
					<select
						value={settings.attachmentLocation}
						onChange={(e) =>
							save({
								attachmentLocation: e.target
									.value as MyPluginSettings["attachmentLocation"],
							})
						}
					>
						<option value="bottom">Bottom</option>
						<option value="top">Top</option>
					</select>
				}
			/>
			<SettingRow
				name="Hide attachment folder"
				description="Hide each blog's attachment folder from the file explorer"
				control={
					<div
						className={`checkbox-container${settings.hideAttachmentFolder ? " is-enabled" : ""}`}
						onClick={() =>
							save({
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
