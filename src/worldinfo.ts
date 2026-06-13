export function importSillyTavernWorldInfo(json, setWorldInfo, importBehavior) {
	setWorldInfo(prevWorldInfo => {
		let updatedEntries;

		if (importBehavior === "replace") {
			updatedEntries = [];
		} else if (importBehavior === "append") {
			updatedEntries = [...prevWorldInfo.entries];
		} else {
			throw new Error("Unknown import behavior " + importBehavior);
			return;
		}

		Object.values(json.entries)?.forEach(entry => {
			updatedEntries.push({
				"displayName": entry.comment,
				"text": entry.content,
				"keys": [...entry.key],
				"search": entry.scanDepth || ""
			});
		});

		return {
			...prevWorldInfo,
			entries: updatedEntries
		};
	});
}
