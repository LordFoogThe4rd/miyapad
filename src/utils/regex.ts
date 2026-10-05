export function regexSplitString(str: string, separator: string | RegExp, limit?: number) {
	const result = [];
	const separators = [];
	let lastIndex = 0;
	let match;
	const source = separator instanceof RegExp ? separator.source : separator;
	const existingFlags = separator instanceof RegExp ? separator.flags : '';
	const flags = existingFlags.includes('g') ? existingFlags : existingFlags + 'g';
	const regex = new RegExp(source, flags);
	
	while ((match = regex.exec(str)) !== null) {
			if (limit !== undefined && result.length >= limit) break;

			result.push(str.slice(lastIndex, match.index));
			separators.push(match[0]);
			lastIndex = match.index + match[0].length;
	}
	
	result.push(str.slice(lastIndex)); // Add the remainder of the string
	
	return [result, separators];
}

export function regexIndexOf(string: string, regex: RegExp, startpos?: number) {
    var indexOf = string.substring(startpos || 0).search(regex);
    return (indexOf >= 0) ? (indexOf + (startpos || 0)) : indexOf;
}

export function regexLastIndexOf(string: string, regex: RegExp, startpos?: number) {
    regex = regex.global ? regex : new RegExp(regex.source, regex.flags + 'g');
    if(typeof (startpos) == "undefined") {
        startpos = string.length;
    } else if(startpos < 0) {
        startpos = 0;
    }
    var stringToWorkWith = string.substring(0, startpos + 1);
    var lastIndexOf = -1;
    var nextStop = 0;
    var result;
    while((result = regex.exec(stringToWorkWith)) != null) {
        lastIndexOf = result.index;
        regex.lastIndex = ++nextStop;
    }
    return lastIndexOf;
}

export function memoize<T extends (...args: any[]) => any>(fn: T): T {
	let cache: Record<string, any> = {};
	const memoized = (...args: any[]) => {
		const key = JSON.stringify(args);
		if (key in cache) {
			return cache[key];
		}
		else {
			let result = fn(...args);
			cache[key] = result;
			return result;
		}
	}
	return memoized as T;
}

/**
 * What `str.replace(regex, pattern)` puts in place of one of its matches: expands `$$`, `$&`,
 * `` $` ``, `$'`, `$n`, `$nn` and `$<name>` the same way.
 */
export function expandReplacement(pattern: string, match: RegExpExecArray, str: string): string {
	const captures = match.length - 1;
	return pattern.replace(/\$(?:([$&`'])|(\d\d?)|<([^>]*)>)/g, (ref, symbol, digits, name) => {
		if (symbol === '$') return '$';
		if (symbol === '&') return match[0];
		if (symbol === '`') return str.slice(0, match.index);
		if (symbol === "'") return str.slice(match.index + match[0].length);
		if (digits === undefined) return match.groups ? match.groups[name] ?? '' : ref;
		// $nn reads as $n followed by a digit when there is no nn-th group
		let n = Number(digits);
		let rest = '';
		if (n > captures && digits.length === 2) {
			n = Number(digits[0]);
			rest = digits[1];
		}
		return n >= 1 && n <= captures ? (match[n] ?? '') + rest : ref;
	});
}

export function escapeRegExp(string: string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

export function makeWhiteSpaceLenient(string: string) {
	return string.replace(/\s+/g, '')
		// Add \s* between characters, but preserve escaped sequences
		.replace(/(?<!\\)(?:\\{2})*(?!\s)(?!$)/g, '$&\\s*');
}

export const createLenientPrefixRegex = memoize((prefix: string) => {
	return new RegExp("^" + makeWhiteSpaceLenient(escapeRegExp(prefix)), 'i');
});

export const createLenientRegex = memoize((suffix: string) => {
	return new RegExp(makeWhiteSpaceLenient(escapeRegExp(suffix)).replace(/^\\s\*/, '(^\\s*)?'), 'i');
});

export function prefixMatchLength(str1: string, str2: string) {
	if (str1 === "" || str2 === "") {
		return 0;
	}

	for (let len = str1.length; len > 0; len--) {
		for (let i = 0; i <= str1.length - len; i++) {
			const sub = str1.substring(i, i + len);
			if (str2.startsWith(sub)) {
				return len;
			}
		}
	}

	return 0;
}
