import { html } from 'htm/react';
import { useState, useEffect, useRef } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import { Widget } from './Widget';
import { InputBox } from './controls/InputBox';
import { SelectBox } from './controls/SelectBox';
import { SVG_ArrowUp, SVG_ArrowDown } from './icons/index';
import { useT } from '../i18n';

export function SearchAndReplaceWidget({ isOpen, closeWidget, id, children, promptArea, promptText, cancel, ...props }: any) {
	const t = useT();
	const modeLabels: Record<number, string> = { 0: t('search.plaintext'), 1: t('search.regex'), 2: 'Template' };
	const [searchAndReplaceError, setSearchAndReplaceError] = useState<string | undefined>(undefined);
	const [searchAndReplaceMode, setSearchAndReplaceMode] = usePersistentState('searchAndReplaceMode', 0);
	// Normalise persisted value that was removed from the UI
	useEffect(() => {
		if (searchAndReplaceMode === 2) {
			setSearchAndReplaceMode(0);
		}
	}, []);
	const [searchTerm, setSearchTerm] = usePersistentState('searchTerm','');
	const [searchFlags, setSearchFlags] = usePersistentState('searchFlags','gi');
	const [replaceTerm, setReplaceTerm] = usePersistentState('replaceTerm','');
	const [numMatches, setNumMatches] = useState(0);
	const [inputElement, setInputElement] = useState<HTMLElement | null>(null);
	const [replacedTrigger, setReplacedTrigger] = useState(false);
	const positions = useRef<{ start: number; end: number }[]>([]);
	const [currentIndex, setCurrentIndex] = useState(-1);

	useEffect(() => {
		if (promptArea.current) {
			setInputElement(promptArea.current);
		}
	}, [promptArea]);

	function handleFindNext(mode: any,search: any,flags: any) {
		setSearchAndReplaceError(undefined)
		if (!search)
			return
		switch(mode) {
			case 0:
				findNextMatch(mode,search,flags,inputElement)
				break;
			case 1:
				findNextMatch(mode,search,flags,inputElement)
				break;
		}
	}
	function handleFindPrev(mode: any,search: any,flags: any) {
		setSearchAndReplaceError(undefined)
		if (!search)
			return
		switch(mode) {
			case 0:
				findPrevMatch(mode,search,flags,inputElement)
				break;
			case 1:
				findPrevMatch(mode,search,flags,inputElement)
				break;
		}
	}

	function findAllMatches(mode: any, search: any, flags: any, elem: any) {
		if (!inputElement)
			return [];
		setSearchAndReplaceError(undefined)
		let startIndex = 0;
		let index;
		let match;
		let positions = [];
		let text = elem.value;

		if (mode == 0) {
			while ((index = text.indexOf(search, startIndex)) > -1) {
					positions.push({ start: index, end: index + search.length });
					startIndex = index + search.length;
			}
		}
		else if (mode == 1) {
			try {
				if (flags && !flags.includes("g"))
					flags += "g" // if no global flag, while loop is infinite
				else if (flags == "")
					flags = "g"
				let re = new RegExp(String.raw`${search}`, String.raw`${flags ?? "g"}`);
				while ((match = re.exec(text)) !== null) {
					positions.push({ start: match.index, end: re.lastIndex });
					if (match.index === re.lastIndex) {
						re.lastIndex++;
					}
				}
			}
			catch (e: unknown) {
				reportError(e);
				const errStr = String(e);
				setSearchAndReplaceError(errStr);
				return [];
			}
		}
		return positions;
	}
	function highlightIndex(elem: any, index: any) {
		if (positions.current.length > 0 && index >= 0 && index < positions.current.length) {
			const position = positions.current[index];
			elem.focus();
			elem.scrollTop = 0;

			// Scroll to selection position.
			const fullText = elem.value;
			elem.value = fullText.substring(0, position.end);
			elem.scrollTop = elem.scrollHeight;
			elem.value = fullText;

			elem.setSelectionRange(position.start, position.end);
		}
	}
	function findNextMatch(mode: any,search: any,flags: any,elem: any) {
		if (positions.current.length === 0) {
			findAndStorePositions(mode,search,flags,elem);
		}
		if (positions.current.length > 0) {
			let index = (currentIndex + 1) % positions.current.length;
			setCurrentIndex(index);
			highlightIndex(inputElement, index);
		}
	}

	function findPrevMatch(mode: any,search: any,flags: any,elem: any) {
		if (positions.current.length === 0) {
			findAndStorePositions(mode,search,flags,elem);
		}
		if (positions.current.length > 0) {
			let index = (currentIndex - 1 + positions.current.length) % positions.current.length;
			setCurrentIndex(index);
			highlightIndex(inputElement, index);
		}
	}

	function findAndStorePositions(mode: any,search: any,flags: any,elem: any) {
		positions.current = findAllMatches(mode, search, flags, elem);
		setCurrentIndex(-1); 
		if (!searchAndReplaceError && positions.current.length === 0)
			setSearchAndReplaceError(`${t('search.warningNoMatches')} ${modeLabels[mode] ?? modeLabels[0]} '${search}'`)
	}

	function handleSearchAndReplace(mode: any,search: any,flags: any,replace: any) {
		// TODO
		// Add this to undo/redo
		setSearchAndReplaceError(undefined)
		if (!search)
			return
		positions.current = findAllMatches(mode, search, flags, inputElement);
		if (!searchAndReplaceError && positions.current.length === 0) {
			setSearchAndReplaceError(`${t('search.warningNoMatches')} ${modeLabels[mode] ?? modeLabels[0]} '${search}'`)
			return
		}
		setReplacedTrigger((prev) => !prev)

		switch(mode) {
			case 0:
				plaintextReplace(search,replace,inputElement)
				break;
			case 1:
				regexReplace(search,flags,replace,inputElement)
				break;
		}
	}

	function plaintextReplace(search: any,replace: any,elem: any) {
		try {
			const newVal = elem.value.replaceAll(search,replace);
			elem.focus();
			elem.select();
			document.execCommand('insertText', false, newVal);
		}
		catch (e: unknown) {
			reportError(e);
		}
	}
	function regexReplace(search: any,flags: any,replace: any,elem: any) {
		try {
			const gFlags = flags && !flags.includes('g') ? flags + 'g' : flags || 'g';
			let re = new RegExp(String.raw`${search}`, String.raw`${gFlags}`);
			const newVal = elem.value.replace(re, replace.replace(/\\n/g, '\n'));
			elem.focus();
			elem.select();
			document.execCommand('insertText', false, newVal);
		}
		catch (e: unknown) {
			reportError(e);
			const errStr = String(e)
			setSearchAndReplaceError(errStr)
		}
	}

	function countMatches(mode: any, search: any, flags: any) {
		setSearchAndReplaceError(undefined)
		if (!searchTerm) {
			setNumMatches(0)
			return
		}
		positions.current = findAllMatches(mode, search, flags, inputElement);
		try {
			setNumMatches(positions.current.length ?? 0)
		}
		catch {
			setNumMatches(0)
		}
		if (positions.current.length <= currentIndex) {
			setCurrentIndex(positions.current.length - 1);
		}
	}

	useEffect(() => {
		countMatches(searchAndReplaceMode,searchTerm,searchFlags)
	}, [searchAndReplaceMode,searchTerm,searchFlags,isOpen,replacedTrigger,promptText]);

	return html`
		<${Widget} isOpen=${isOpen} onClose=${closeWidget}
			title=${t('search.title')}
			id="${id}">
				${children}
				<div class="searchAndReplace-inputs">
					<${SelectBox}
						label=${t('search.mode')}
						value=${searchAndReplaceMode}
						onValueChange=${setSearchAndReplaceMode}
						options=${[
							{ name: t('search.plaintext'), value: 0 },
							{ name: t('search.regex'), value: 1 },
							// { name: 'Template', value: 2 },
						]}/>
					${searchAndReplaceMode == 0 && html`
						<${InputBox} label=${t('search.searchThis')} type="text"
							placeholder=${t('search.searchPlaceholder')}
							value=${searchTerm} onValueChange=${setSearchTerm}/>
						<${InputBox} label=${t('search.replaceWith')} type="text"
							placeholder=${t('search.replacePlaceholder')}
							readOnly=${!!cancel} value=${replaceTerm} onValueChange=${setReplaceTerm}/>
					`}
					${searchAndReplaceMode == 1 && html`
						<${InputBox} label=${t('search.searchThisRegex')} type="text"
							placeholder=${t('search.regexSearchPlaceholder')}
							value=${searchTerm} onValueChange=${setSearchTerm}/>
						<div style=${{ 'flex':'0 1 min-content' }}>
							<${InputBox} label=${t('search.flags')} type="text"
								placeholder="gi"
								value=${searchFlags} onValueChange=${setSearchFlags}/>
						</div>
						<${InputBox} label=${t('search.replaceWith')} type="text"
							placeholder=${t('search.regexReplacePlaceholder')}
							value=${replaceTerm} onValueChange=${setReplaceTerm}/>
					`}
				</div>
				<div class="searchAndReplace-buttons">
					<div class="flexfiller"/>
					<div class="number-matches">
						${currentIndex >= 0 ? (currentIndex+1) + " /" : ""} ${ searchTerm != "" ? numMatches + (numMatches == 1 ? t('search.matchOne') : t('search.matchMany')) : ""}
					</div>
					<button
						class="findButton"
						title=${t('search.findPrev')}
						onClick=${() => handleFindPrev(searchAndReplaceMode,searchTerm,searchFlags)}>
						<${SVG_ArrowUp}/>
					</button>
					<button
						class="findButton"
						title=${t('search.findNext')}
						onClick=${() => handleFindNext(searchAndReplaceMode,searchTerm,searchFlags)}>
							<${SVG_ArrowDown}/>
					</button>
					<button
						title=${t('search.replaceAllTitle')}
						disabled=${!!cancel}
						onClick=${() => handleSearchAndReplace(searchAndReplaceMode,searchTerm,searchFlags,replaceTerm)}>
							${t('search.replaceAll')}
					</button>
				</div>
				${!!searchAndReplaceError && html`
					<div style=${{margin:"8px auto"}} className="error-text">${searchAndReplaceError}</div>`}
		</${Widget}>`;
}
