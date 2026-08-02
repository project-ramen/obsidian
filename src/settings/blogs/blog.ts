export function normalizeBlogUrl(raw: string): string {
	let url = raw.trim().replace(/\/+$/, '');
	if (!url.startsWith('http://') && !url.startsWith('https://')) url = `https://${url}`;
	try {
		const u = new URL(url);
		if (u.pathname === '/reman' || u.pathname === '/reman/') {
			u.pathname = '/';
			return u.toString().replace(/\/+$/, '');
		}
	} catch { /* ignore */ }
	return url;
}

export function persistBlogConnection(rootFolder: string, blogUrl: string, password: string): void {
	localStorage.setItem('ramen-blog-config', JSON.stringify({ blogUrl, password }));
	const key = rootFolder.replace(/\\/g, '/').replace(/\/+$/, '').trim();
	if (!key) return;
	try {
		const raw = localStorage.getItem('ramen-vault-root-addresses');
		const map: Record<string, { blogUrl: string; password: string }> = raw
			? JSON.parse(raw) as Record<string, { blogUrl: string; password: string }>
			: {};
		map[key] = { blogUrl, password };
		localStorage.setItem('ramen-vault-root-addresses', JSON.stringify(map));
	} catch { /* ignore */ }
}
