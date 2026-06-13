// Polyfill for piece of shit Chromium
if (!(Symbol.asyncIterator in ReadableStream.prototype)) {
	ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
		const reader = this.getReader();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done)
					return;
				yield value;
			}
		} finally {
			reader.releaseLock();
		}
	};
}
