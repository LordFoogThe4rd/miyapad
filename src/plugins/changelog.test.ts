import { describe, expect, it } from 'vitest';
import { extractChangelogSection } from './changelog';

const sample = [
	'# Changelog',
	'',
	'## [1.4.0] - 2026-11-24',
	'',
	'### Added',
	'- Custom date formatting',
	'',
	'## 1.3.0 - 2026-10-01',
	'- Plain heading entry',
	'',
	'## [1.4] - 2026-09-01',
	'- Short version entry',
].join('\n');

describe('extractChangelogSection', () => {
	it('reads both bracketed and plain version headings up to the next ## heading', () => {
		expect(extractChangelogSection(sample, '1.4.0')).toBe('### Added\n- Custom date formatting');
		expect(extractChangelogSection(sample, '1.3.0')).toBe('- Plain heading entry');
	});

	it('matches the exact version rather than a prefix', () => {
		expect(extractChangelogSection(sample, '1.4')).toBe('- Short version entry');
		expect(extractChangelogSection('## 1.4.0\n- Full\n', '1.4')).toBeUndefined();
		expect(extractChangelogSection('## [1.4.0]\n- Full\n', '1.4')).toBeUndefined();
	});

	it('returns undefined when changelog or the version section is missing or empty', () => {
		expect(extractChangelogSection(undefined, '1.0.0')).toBeUndefined();
		expect(extractChangelogSection(sample, undefined)).toBeUndefined();
		expect(extractChangelogSection(sample, '9.9.9')).toBeUndefined();
		expect(extractChangelogSection('## [1.0.0]\n\n## [0.9.0]\n- Earlier', '1.0.0')).toBeUndefined();
	});

	it('takes the first matching section when duplicate headings exist', () => {
		const dup = '## [1.0.0]\n- First\n\n## [1.0.0]\n- Second\n';
		expect(extractChangelogSection(dup, '1.0.0')).toBe('- First');
	});

	it('caps long sections at 1,000 characters with an ellipsis', () => {
		const longBody = 'x'.repeat(1200);
		const result = extractChangelogSection(`## [2.0.0]\n${longBody}`, '2.0.0');
		expect(result).toBeDefined();
		expect(result!.length).toBe(1000);
		expect(result!.endsWith('…')).toBe(true);
	});
});
