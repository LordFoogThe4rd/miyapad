interface SillyTavernWorldInfoEntry {
	key: string[];
	comment: string;
	content: string;
	scanDepth?: string | null;
}

interface SillyTavernWorldInfo {
	entries?: Record<string, SillyTavernWorldInfoEntry>;
}

type SetWorldInfo = (value: WorldInfoData | ((prev: WorldInfoData) => WorldInfoData)) => void;

export function importSillyTavernWorldInfo(json: SillyTavernWorldInfo, setWorldInfo: SetWorldInfo, importBehavior: "replace" | "append") {
	setWorldInfo((prevWorldInfo) => {
		let updatedEntries: WorldInfoEntry[];

		if (importBehavior === "replace") {
			updatedEntries = [];
		} else {
			updatedEntries = [...prevWorldInfo.entries];
		}

		Object.values(json.entries ?? {}).forEach((entry) => {
			updatedEntries.push({
				displayName: entry.comment,
				text: entry.content,
				keys: [...entry.key],
				search: entry.scanDepth || ""
			});
		});

		return {
			...prevWorldInfo,
			entries: updatedEntries
		};
	});
}
