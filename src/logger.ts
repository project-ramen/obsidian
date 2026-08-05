let debugEnabled = false;

export function setDebugMode(enabled: boolean): void {
	debugEnabled = enabled;
}

export function debugLog(...args: unknown[]): void {
	if (debugEnabled) console.debug(...args);
}
