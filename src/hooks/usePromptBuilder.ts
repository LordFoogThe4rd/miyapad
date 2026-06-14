import { useMemo, useState } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useGeneration } from '../contexts/GenerationContext';
import { defaultPresets } from '../defaults/presets';
import { joinPrompt, replaceNewlines } from '../utils/strings';
import { regexSplitString, regexIndexOf, prefixMatchLength, createLenientPrefixRegex, createLenientRegex } from '../utils/regex';

export function usePromptBuilder() {
	const { templates, selectedTemplate, worldInfo, memoryTokens, authorNoteTokens, authorNoteDepth, contextLength, templateReplacements, setTemplateReplacements } = useSettings();
	const { promptChunks, cancel } = useGeneration();

	function replacePlaceholders(string: string, placeholders: Record<string, string>) {
		return string.replace(/\{[^}]+\}/g, function (placeholder: string) {
			return placeholders.hasOwnProperty(placeholder)
				? placeholders[placeholder]
				: placeholder;
		}).replace(/\\n/g, '\n')
	};
	useMemo(() => {
		setTemplateReplacements({
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
		})
	}, [selectedTemplate,templates])
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

		let leftPromptChunks = undefined;
		let rightPromptChunks = undefined;
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
				if ((left.length >= 2 && (left[left.length - 2] != ' ' || left[left.length - 2] != '\t')) && left[left.length - 1] == ' ') {
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

	// compute separately as I imagine this can get expensive
	const assembledWorldInfo = useMemo(() => {
		// assemble non-empty wi
		const validWorldInfo = !Array.isArray(worldInfo.entries) ? [] : worldInfo.entries.filter((entry: any) =>
			entry.keys.length > 0 && !(entry.keys.length == 1 && entry.keys[0] == "") && entry.text !== "");

		// search prompt
		const activeWorldInfo = validWorldInfo.filter((entry: any) => {
			if (validWorldInfo.length < 1) { return }
			// default to 2048
			const searchRange = isNaN(entry.search) || entry.search === ""
				? 2048
				: Number(entry.search);

			// truncate to search range. using promptText allows for search ranges larger than context
			const searchPrompt = modifiedPromptText.substring(modifiedPromptText.length - searchRange * defaultPresets.tokenRatio);

			// search in range
			return entry.keys.some((key: any, index: any) => {
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
			? activeWorldInfo.map((entry: any) => entry.text).join("\n")
			: "";
	}, [modifiedPromptText, worldInfo]);

	const additionalContextPrompt = useMemo(() => {
		// add world info to memory for easier assembly
		memoryTokens["worldInfo"] = assembledWorldInfo;

		const order: (keyof AuthorNoteData)[] = ["prefix","text","suffix"]
		const assembledAuthorNote = authorNoteTokens.text && authorNoteTokens.text !== ""
			? order.map(key => authorNoteTokens[key]).join("").replace(/\\n/g,'\n')
			: "";

		// replacements for the contextOrder string
		const contextReplacements: Record<string, any> = {
			"{wiPrefix}": assembledWorldInfo && assembledWorldInfo !== ""
				? worldInfo.prefix
				: "", // wi prefix and suffix will be added whenever wi isn't empty
			"{wiText}": assembledWorldInfo,
			"{wiSuffix}": assembledWorldInfo && assembledWorldInfo !== ""
				? worldInfo.suffix
				: "",

			"{memPrefix}": memoryTokens.text && memoryTokens.text !== "" || assembledWorldInfo !== ""
				? memoryTokens.prefix
				: "", // memory prefix and suffix will be added whenever memory or wi aren't empty
			"{memText}": memoryTokens.text,
			"{memSuffix}": memoryTokens.text && memoryTokens.text !== "" || assembledWorldInfo !== ""
				? memoryTokens.suffix
				: "",
		}

		// prompt length estimation
		const additionalContext = (Object.values(contextReplacements)
			.filter(value => typeof value === 'string').join('')).length;
		const estimatedContextStart = Math.round(
			modifiedPromptText.length - contextLength * defaultPresets.tokenRatio + additionalContext) + 1;

		// trunkate prompt to context limit
		const truncPrompt = modifiedPromptText.substring(estimatedContextStart);

		// make injection depth valid
		const truncPromptLen = truncPrompt.split('\n').length;
		const injDepth = truncPromptLen > authorNoteDepth ? authorNoteDepth : truncPromptLen

		const lines = truncPrompt.match(/.*\n?/g);
		const injIndex = lines.length-injDepth-1
		// inject an
		lines.splice(injIndex,0,assembledAuthorNote)
		// if an, return an context, else return original truncated context
		const authorNotePrompt = assembledAuthorNote != ""
			? lines.join('')
			: truncPrompt;

		// add the final replacement
		contextReplacements["{prompt}"] = authorNotePrompt

		const workingContextOrder = memoryTokens.contextOrder && memoryTokens.contextOrder !== ""
			? memoryTokens.contextOrder
			: defaultPresets.memoryTokens.contextOrder;

		// assemble context in order:
		// the context is (1) split by line, (2) persistent context placeholders are 
		// replaced, (3) instruct template placeholders are replaced (4) non-empty
		// lines are joined back together.
		const permContextPrompt = workingContextOrder.split("\n").map(function (line: any) {
			return replacePlaceholders(line,contextReplacements)
		}).filter(function (line: any) {
			return line.trim() !== "";
		}).join("\n").replace(/\\n/g, '\n');

		return permContextPrompt;
	}, [contextLength, modifiedPromptText, memoryTokens, authorNoteTokens, authorNoteDepth, assembledWorldInfo, worldInfo.prefix, worldInfo.suffix]);

	const finalPromptText = useMemo(() => {
		let text = replacePlaceholders(additionalContextPrompt, templateReplacements);
		return text;
	}, [additionalContextPrompt, templates, selectedTemplate]);
	function convertChatToJSON(chatString: string, template: InstructTemplate) {
		function extractMessage(text: any, prefix: any, suffixes: any, role: any) {
			const matches = text.match(createLenientPrefixRegex(prefix));
			if (matches && matches.length) {
				text = text.substring(matches[0].length);
				let endIndex = suffixes[0] ? regexIndexOf(text, createLenientRegex(suffixes[0])) : -1;
				if (endIndex === -1) {
					if (suffixes.length > 1) {
						const indices = suffixes.slice(1).map((suffix: any) => suffix ? regexIndexOf(text, createLenientRegex(suffix)) : -1).filter((index: any) => index !== -1);
						endIndex = indices.length > 0 ? Math.min(...indices) : text.length;
					}  else {
						endIndex = text.length;
					}
				}
				let content = text.substring(0, endIndex);
				content = endIndex !== text.length ? content.trim() : content.trimLeft();
				return {
					message: { role, content },
					remainingString: text.substring(endIndex)
				};
			}
			return null;
		}

		function skipToNextKnownPrefix(text: any, ...prefixes: any[]) {
			const indices = prefixes.map(prefix => prefix ? regexIndexOf(text, createLenientRegex(prefix)) : -1).filter(index => index !== -1);
			const minIndex = indices.length > 0 ? Math.min(...indices) : text.length;
			if (minIndex == 0) {
				console.warn("Something went wrong!");
				return "";
			}
			return text.substring(minIndex);
		}

		if (!template || typeof template !== 'object') {
			console.warn('Invalid or missing template object!');
			return [];
		}

		const messages = [];
		const { sysPre, sysSuf, instPre, instSuf } = replaceNewlines(template);

		let remainingString = chatString.trimStart();

		const indices = [sysPre, instPre].map(prefix => prefix ? regexIndexOf(remainingString, createLenientPrefixRegex(prefix)) : -1).filter(index => index !== -1);
		const minIndex = indices.length > 0 ? Math.min(...indices) : remainingString.length;
		if (minIndex !== 0) {
			// The prompt doesn't start with any of the prefixes.
			// So let's assume it's a instruction.
			const matchLen = prefixMatchLength(instPre.trim(), remainingString);
			remainingString = instPre + remainingString.substring(matchLen);
		}

		while (remainingString.length > 0) {
			let extracted = null;
			if (sysPre) {
				extracted = extractMessage(remainingString, sysPre, [sysSuf, instPre, instSuf], 'system');
			}
			if (instPre && !extracted) {
				extracted = extractMessage(remainingString, instPre, [instSuf], 'user');
			}
			if (instSuf && !extracted) {
				extracted = extractMessage(remainingString, instSuf, [instPre], 'assistant');
			}
			if (!extracted) {
				remainingString = skipToNextKnownPrefix(remainingString, sysPre, instPre, instSuf);
				continue;
			}
			messages.push(extracted.message);
			remainingString = extracted.remainingString;
		}

		const lastMessage = messages?.length ? messages[messages.length - 1] : null;
		if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content.length === 0) {
			messages.pop();
		}

		return messages;
	}

	return { promptText, modifiedPromptText, fimPromptInfo, assembledWorldInfo, additionalContextPrompt, finalPromptText, templateReplacements, replacePlaceholders, convertChatToJSON, displayPromptChunks, cleanPromptText, origToClean, cleanToOrig };
}
