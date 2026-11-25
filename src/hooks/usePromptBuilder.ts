import { useMemo } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useGeneration } from '../contexts/GenerationContext';
import { defaultPresets } from '../defaults/presets';
import { convertChatToJSON } from '../api/request';
import { expandPluginPlaceholders, usePluginContext } from '../plugins/context';
import { joinPrompt } from '../utils/strings';
import { regexSplitString } from '../utils/regex';

function joinInjections(entries: readonly { text: string }[]): string {
	let out = '';
	for (const entry of entries) {
		if (!entry.text) continue;
		if (out.length > 0 && !out.endsWith('\n')) out += '\n';
		out += entry.text;
	}
	return out;
}

export function usePromptBuilder() {
	const { templates, selectedTemplate, worldInfo, memoryTokens, authorNoteTokens, authorNoteDepth, contextLength } = useSettings();
	const { promptChunks, cancel } = useGeneration();
	const { injections, placeholders } = usePluginContext();

	function replacePlaceholders(string: string, placeholders: Record<string, string>) {
		return string.replace(/\{[^}]+\}/g, function (placeholder: string) {
			return Object.hasOwn(placeholders, placeholder)
				? placeholders[placeholder]
				: placeholder;
		}).replace(/\\n/g, '\n');
	}
	const templateReplacements = useMemo(() => ({
			"{inst}": templates[selectedTemplate]?.instPre && templates[selectedTemplate]?.instPre !== ""
				? templates[selectedTemplate]?.instPre
				: "",
			"{/inst}": templates[selectedTemplate]?.instSuf && templates[selectedTemplate]?.instSuf !== ""
				? templates[selectedTemplate]?.instSuf
				: "",
			"{sys}": templates[selectedTemplate]?.sysPre && templates[selectedTemplate]?.sysPre !== ""
				? templates[selectedTemplate]?.sysPre
				: "",
			"{/sys}": templates[selectedTemplate]?.sysSuf && templates[selectedTemplate]?.sysSuf !== ""
				? templates[selectedTemplate]?.sysSuf
				: "",
	}), [selectedTemplate,templates])
	const promptText = useMemo(() => joinPrompt(promptChunks), [promptChunks]);

	const displayPromptChunks = promptChunks;
	const cleanPromptText = promptText;
	const origToClean = null;
	const cleanToOrig = null;

	const { modifiedPromptText, fimPromptInfo } = useMemo(() => {
		if (cancel)
			return { modifiedPromptText: promptText };

		const fillPlaceholder = "{fill}";
		const predictPlaceholder = "{predict}";

		let placeholderRegex = predictPlaceholder;
		if (templates[selectedTemplate]?.fimTemplate !== undefined && templates[selectedTemplate]?.fimTemplate.length > 0)
			placeholderRegex += `|${fillPlaceholder}`;

		let leftPromptChunks: PromptChunk[] | undefined = undefined;
		let rightPromptChunks: PromptChunk[] | undefined = undefined;
		let foundPlaceholder = undefined;

		for (let i = 0; i < promptChunks.length; i++) {
			const chunk = promptChunks[i];
			if (chunk.type !== 'user')
				continue;
			
			if (chunk.content.includes(fillPlaceholder) || chunk.content.includes(predictPlaceholder)) {
				// split the chunk in 2
				let [sides, separators] = regexSplitString(chunk.content, placeholderRegex, 1);
				foundPlaceholder = separators[0];

				let left = sides[0];
				if ((left.length >= 2 && (left[left.length - 2] != ' ' && left[left.length - 2] != '\t')) && left[left.length - 1] == ' ') {
					// This is most likely an unintentional mistake by the user.
					left = left.substring(0, left.length - 1);
				}
				leftPromptChunks = [
					...promptChunks.slice(0, i),
					...(left ? [{ type: 'user' as const, content: left }] : [])
				];

				let right = sides[1];
				rightPromptChunks = [
					...(right ? [{ type: 'user' as const, content: right }] : []),
					...promptChunks.slice(i + 1, promptChunks.length),
				];
				break;
			}
		}

		if (foundPlaceholder === undefined)
			return { modifiedPromptText: promptText };

		let modifiedPromptText;
		if (foundPlaceholder == '{fill}') {
			const prefix = joinPrompt(leftPromptChunks);
			const suffix = joinPrompt(rightPromptChunks);

			modifiedPromptText = replacePlaceholders(templates[selectedTemplate]?.fimTemplate ?? '', {
				'{prefix}': prefix,
				'{suffix}': suffix
			});
		} else {
			modifiedPromptText = joinPrompt(leftPromptChunks);
		}

		const fimPromptInfo = {
			fimLeftChunks: leftPromptChunks,
			fimRightChunks: rightPromptChunks,
			fimPlaceholder: foundPlaceholder
		};

		return {
			modifiedPromptText,
			fimPromptInfo
		};
	}, [promptChunks, templates, selectedTemplate, cancel]);

	const expandedPromptText = useMemo(
		() => expandPluginPlaceholders(modifiedPromptText, placeholders),
		[modifiedPromptText, placeholders],
	);

	const expandedInjections = useMemo(
		() => injections
			.map(inj => ({ ...inj, text: expandPluginPlaceholders(inj.text, placeholders) }))
			.filter(inj => inj.text.length > 0),
		[injections, placeholders],
	);

	// compute separately as I imagine this can get expensive
	const assembledWorldInfo = useMemo(() => {
		// assemble non-empty wi
		const validWorldInfo = !Array.isArray(worldInfo.entries) ? [] : worldInfo.entries.filter((entry: any) =>
			entry.keys.length > 0 && !(entry.keys.length == 1 && entry.keys[0] == "") && entry.text !== "");

		const scanInjectionText = joinInjections(expandedInjections.filter(inj => inj.scanWorldInfo));

		// search prompt
		const activeWorldInfo = validWorldInfo.filter((entry: any) => {
			if (validWorldInfo.length < 1) { return }
			// default to 2048
			const searchRange = isNaN(entry.search) || entry.search === ""
				? 2048
				: Number(entry.search);

			// truncate to search range. using promptText allows for search ranges larger than context
			const baseSlice = expandedPromptText.substring(expandedPromptText.length - searchRange * defaultPresets.tokenRatio);
			const searchPrompt = scanInjectionText
				? (baseSlice ? `${baseSlice}\n${scanInjectionText}` : scanInjectionText)
				: baseSlice;

			// search in range
			return entry.keys.some((key: any) => {
				// don't waste resources on disabled entries
				if (searchPrompt.length == 0) {
					return
				}

				// an invalid regex here can completely lock you out of miyapad until you clear
				// localStorage, so this is necessary to handle that.
				try {
					return new RegExp(key, "i").test(searchPrompt) && key !== "";
				}
				catch (e: unknown) {
					console.error(`Error in RegEx for key '${key}': ${e instanceof Error ? e.message : String(e)}`);
					return false;
				}
			});
		});

		return activeWorldInfo.length > 0
			? activeWorldInfo.map((entry: any) => expandPluginPlaceholders(entry.text, placeholders)).join("\n")
			: "";
	}, [expandedPromptText, expandedInjections, placeholders, worldInfo]);

	const additionalContextPrompt = useMemo(() => {
		const order: (keyof AuthorNoteData)[] = ["prefix", "text", "suffix"];
		const expandedAuthorNoteText = expandPluginPlaceholders(authorNoteTokens.text ?? '', placeholders);
		const assembledAuthorNote = expandedAuthorNoteText !== ""
			? order.map(key => key === 'text' ? expandedAuthorNoteText : authorNoteTokens[key]).join("").replace(/\\n/g, '\n')
			: "";

		const expandedMemoryText = expandPluginPlaceholders(memoryTokens.text ?? '', placeholders);

		// replacements for the contextOrder string
		const contextReplacements: Record<string, string> = {
			"{wiPrefix}": assembledWorldInfo && assembledWorldInfo !== ""
				? worldInfo.prefix
				: "", // wi prefix and suffix will be added whenever wi isn't empty
			"{wiText}": assembledWorldInfo,
			"{wiSuffix}": assembledWorldInfo && assembledWorldInfo !== ""
				? worldInfo.suffix
				: "",

			"{memPrefix}": expandedMemoryText !== "" || assembledWorldInfo !== ""
				? memoryTokens.prefix
				: "", // memory prefix and suffix will be added whenever memory or wi aren't empty
			"{memText}": expandedMemoryText,
			"{memSuffix}": expandedMemoryText !== "" || assembledWorldInfo !== ""
				? memoryTokens.suffix
				: "",
		};

		const beforeInjections = expandedInjections.filter(inj => inj.position === 'before');
		const depthInjections = expandedInjections.filter(inj => inj.position === 'depth');
		const afterInjections = expandedInjections.filter(inj => inj.position === 'after');

		const beforeBlock = joinInjections(beforeInjections);
		const afterBlock = joinInjections(afterInjections);
		const depthChars = depthInjections.reduce((sum, inj) => sum + inj.text.length, 0);
		const beforeExtra = beforeBlock.length > 0
			? beforeBlock.length + (expandedPromptText.length > 0 && !beforeBlock.endsWith('\n') ? 1 : 0)
			: 0;
		const afterExtra = afterBlock.length > 0
			? afterBlock.length + ((expandedPromptText.length > 0 || beforeBlock.length > 0) && !(expandedPromptText || beforeBlock).endsWith('\n') ? 1 : 0)
			: 0;

		// prompt length estimation
		const additionalContext = (Object.values(contextReplacements)
			.filter(value => typeof value === 'string').join('')).length
			+ beforeExtra + depthChars + afterExtra;
		const estimatedContextStart = Math.round(
			expandedPromptText.length - contextLength * defaultPresets.tokenRatio + additionalContext) + 1;

		// truncate prompt to context limit
		const truncPrompt = expandedPromptText.substring(estimatedContextStart);

		let promptWithDepth = truncPrompt;
		if (assembledAuthorNote !== "" || depthInjections.length > 0) {
			const truncPromptLen = truncPrompt.split('\n').length;
			const lines = truncPrompt.match(/.*\n?/g) ?? [];
			const buckets = new Map<number, string[]>();
			const addAt = (depth: number, text: string) => {
				const clamped = truncPromptLen > depth ? depth : truncPromptLen;
				const idx = Math.max(0, lines.length - clamped - 1);
				let bucket = buckets.get(idx);
				if (!bucket) {
					bucket = [];
					buckets.set(idx, bucket);
				}
				bucket.push(text);
			};

			if (assembledAuthorNote !== "") {
				addAt(authorNoteDepth, assembledAuthorNote);
			}
			for (const inj of depthInjections) {
				addAt(inj.depth, inj.text);
			}

			const out: string[] = [];
			for (let i = 0; i < lines.length; i++) {
				const bucket = buckets.get(i);
				if (bucket) out.push(...bucket);
				out.push(lines[i]);
			}
			promptWithDepth = out.join('');
		}

		let promptSection = promptWithDepth;
		if (beforeBlock) {
			promptSection = promptSection
				? `${beforeBlock}${beforeBlock.endsWith('\n') ? '' : '\n'}${promptSection}`
				: beforeBlock;
		}
		if (afterBlock) {
			promptSection = promptSection
				? `${promptSection}${promptSection.endsWith('\n') ? '' : '\n'}${afterBlock}`
				: afterBlock;
		}

		// add the final replacement
		contextReplacements["{prompt}"] = promptSection;

		const workingContextOrder = memoryTokens.contextOrder && memoryTokens.contextOrder !== ""
			? memoryTokens.contextOrder
			: defaultPresets.memoryTokens.contextOrder;

		// assemble context in order:
		// the context is (1) split by line, (2) persistent context placeholders are 
		// replaced, (3) instruct template placeholders are replaced (4) non-empty
		// lines are joined back together.
		const permContextPrompt = workingContextOrder.split("\n").map(function (line: string) {
			return replacePlaceholders(line, contextReplacements);
		}).filter(function (line: string) {
			return line.trim() !== "";
		}).join("\n").replace(/\\n/g, '\n');

		return permContextPrompt;
	}, [contextLength, expandedPromptText, expandedInjections, placeholders, memoryTokens, authorNoteTokens, authorNoteDepth, assembledWorldInfo, worldInfo.prefix, worldInfo.suffix]);

	const finalPromptText = useMemo(() => {
		let text = replacePlaceholders(additionalContextPrompt, templateReplacements);
		return text;
	}, [additionalContextPrompt, templates, selectedTemplate]);

	return { promptText, modifiedPromptText, fimPromptInfo, assembledWorldInfo, additionalContextPrompt, finalPromptText, templateReplacements, replacePlaceholders, convertChatToJSON, displayPromptChunks, cleanPromptText, origToClean, cleanToOrig };
}
