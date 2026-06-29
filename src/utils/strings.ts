export function joinPrompt(prompt: any) {
	return prompt.map((p: any) => p.content).join('');
}

export function replaceUnprintableBytes(inputString: any) {
	const unprintableBytesRegex = /[^\x20-\x7E\u00A0-\uFFFF]/g;

	const replacedString = inputString.replace(unprintableBytesRegex, (match: any) => {
		const charCode = match.charCodeAt(0);
		return `<0x${charCode.toString(16).toUpperCase().padStart(2, '0')}>`;
	});

	return replacedString;
}

export function replaceNewlines<T extends object>(template: T): T {
	return Object.fromEntries(
		Object.entries(template).map(([key, value]) => [key, typeof value === "string" ? value.replaceAll("\\n", "\n") : value])
	) as T;
}
