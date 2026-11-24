export const DEFAULT_CHANGELOG_MAX_CHARS = 1000;

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts the release notes for `version` from a Keep-a-Changelog style `CHANGELOG.md`.
 * Accepts both `## [<version>]` and `## <version>` headings up to the next `## ` heading,
 * and caps long sections at `maxChars` with an ellipsis.
 */
export function extractChangelogSection(
	changelog: string | undefined,
	version: string | undefined,
	maxChars = DEFAULT_CHANGELOG_MAX_CHARS,
): string | undefined {
	if (!changelog || !version) return undefined;

	const escaped = escapeRegExp(version);
	const bracketHeading = new RegExp(`^##\\s+\\[${escaped}\\](?:\\s.*)?$`);
	const plainHeading = new RegExp(`^##\\s+${escaped}(?:\\s.*)?$`);

	const collected: string[] = [];
	let found = false;

	for (const line of changelog.replace(/\r\n/g, '\n').split('\n')) {
		if (!found) {
			if (bracketHeading.test(line) || plainHeading.test(line)) {
				found = true;
			}
			continue;
		}
		if (/^##\s/.test(line)) break;
		collected.push(line);
	}

	if (!found) return undefined;
	const trimmed = collected.join('\n').trim();
	if (!trimmed) return undefined;

	if (trimmed.length > maxChars) {
		return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
	}
	return trimmed;
}
