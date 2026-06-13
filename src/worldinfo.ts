export function importSillyTavernWorldInfo(json: any, setWorldInfo: any, importBehavior: any) {
	setWorldInfo((prevWorldInfo: any) => {
		let updatedEntries: any[];

		if (importBehavior === "replace") {
			updatedEntries = [];
		} else if (importBehavior === "append") {
			updatedEntries = [...prevWorldInfo.entries];
		} else {
			throw new Error("Unknown import behavior " + importBehavior);
			return;
		}

		Object.values(json.entries)?.forEach((entry: any) => {
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
