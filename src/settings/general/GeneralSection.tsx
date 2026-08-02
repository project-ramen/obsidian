import React from "react";
import { SectionProps } from "../types";
import { SettingRow } from "../components";

export function GeneralSection({ settings, save }: SectionProps) {
	return (
		<div>
			<SettingRow
				name="Show dotfiles"
				description="Show dotfiles only inside root folders"
				control={
					<div
						className={`checkbox-container${settings.showDotfiles ? " is-enabled" : ""}`}
						onClick={() =>
							save({ showDotfiles: !settings.showDotfiles })
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
				name="Dotfiles sync"
				description="Sync dotfiles along with other files"
				control={
					<div
						className={`checkbox-container${settings.dotfilesSync ? " is-enabled" : ""}`}
						onClick={() =>
							save({ dotfilesSync: !settings.dotfilesSync })
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
		</div>
	);
}
