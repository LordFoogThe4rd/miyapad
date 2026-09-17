export function joinPrompt(prompt: any) {
	return prompt.map((p: any) => p.content).join('');
}

export function replaceUnprintableBytes(inputString: string): string {
	const result: string[] = [];
	for (let i = 0; i < inputString.length; i++) {
		const code = inputString.charCodeAt(i);
		if (
			(code >= 0x20 && code <= 0x7e)
			|| (code >= 0xa0 && code <= 0xd7ff)
			|| code >= 0xe000
		) {
			result.push(inputString[i]);
		} else if (code >= 0xd800 && code <= 0xdbff && i + 1 < inputString.length) {
			const next = inputString.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				result.push(inputString[i] + inputString[i + 1]);
				i++;
			} else {
				result.push(`<0x${code.toString(16).toUpperCase().padStart(2, '0')}>`);
			}
		} else {
			result.push(`<0x${code.toString(16).toUpperCase().padStart(2, '0')}>`);
		}
	}
	return result.join('');
}

export function replaceNewlines<T extends object>(template: T): T {
	return Object.fromEntries(
		Object.entries(template).map(([key, value]) => [key, typeof value === "string" ? value.replaceAll("\\n", "\n") : value])
	) as T;
}

/** Characters `after` adds over `before`, ignoring what the two share at each end. */
export function insertedLength(before: string, after: string): number {
	const max = Math.min(before.length, after.length);
	let start = 0;
	while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
	let end = 0;
	while (end < max - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
	return after.length - start - end;
}
