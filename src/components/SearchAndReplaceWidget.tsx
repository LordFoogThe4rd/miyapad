import { html } from 'htm/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import { Widget } from './Widget';
import { InputBox } from './controls/InputBox';
import { SelectBox } from './controls/SelectBox';
import { SVG_ArrowUp, SVG_ArrowDown } from './icons/index';
import { useT } from '../i18n';

export function SearchAndReplaceWidget({ isOpen, closeWidget, id, children, editorView, promptText, cancel, ...props }: any) {
	const t = useT();
	const modeLabels: Record<number, string> = { 0: t('search.plaintext'), 1: t('search.regex'), 2: 'Template' };
	const [searchAndReplaceError, setSearchAndReplaceError] = useState<string | undefined>(undefined);
	const [searchAndReplaceMode, setSearchAndReplaceMode] = usePersistentState('searchAndReplaceMode', 0);
	useEffect(() => {
		if (searchAndReplaceMode === 2) {
			setSearchAndReplaceMode(0);
		}
	}, []);
	const [searchTerm, setSearchTerm] = usePersistentState('searchTerm','');
	const [searchFlags, setSearchFlags] = usePersistentState('searchFlags','gi');
	const [replaceTerm, setReplaceTerm] = usePersistentState('replaceTerm','');
	const [numMatches, setNumMatches] = useState(0);
	const [replacedTrigger, setReplacedTrigger] = useState(false);
	const positions = useRef<{ start: number; end: number }[]>([]);
	const [currentIndex, setCurrentIndex] = useState(-1);

	const getText = useCallback((): string => {
		return editorView?.current?.getText() ?? '';
	}, [editorView]);

	function findAllMatches(mode: any, search: any, flags: any) {
		setSearchAndReplaceError(undefined)
		if (!search)
			return []
		let startIndex = 0;
		let index;
		let match;
		const result: { start: number; end: number }[] = [];
		const text = getText();

		if (mode == 0) {
			while ((index = text.indexOf(search, startIndex)) > -1) {
				result.push({ start: index, end: index + search.length });
				startIndex = index + search.length;
			}
		} else if (mode == 1) {
			try {
				let reFlags = flags;
				if (reFlags && !reFlags.includes("g")) reFlags += "g";
				else if (reFlags == "") reFlags = "g";
				let re = new RegExp(String.raw`${search}`, String.raw`${reFlags ?? "g"}`);
				while ((match = re.exec(text)) !== null) {
					result.push({ start: match.index, end: re.lastIndex });
					if (match.index === re.lastIndex) {
						re.lastIndex++;
					}
				}
			} catch (e: unknown) {
				reportError(e);
				setSearchAndReplaceError(String(e));
				return [];
			}
		}
		return result;
	}

	function highlightIndex(index: any) {
		const adapter = editorView?.current;
		if (!adapter) return;
		if (positions.current.length > 0 && index >= 0 && index < positions.current.length) {
			const pos = positions.current[index];
			adapter.focus();
			adapter.setSelection(pos.start, pos.end);
			adapter.scrollIntoView(pos.start, { y: 'center' });
		}
	}

	function findNextMatch(mode: any, search: any, flags: any) {
		if (positions.current.length === 0) {
			findAndStorePositions(mode, search, flags);
		}
		if (positions.current.length > 0) {
			let index = (currentIndex + 1) % positions.current.length;
			setCurrentIndex(index);
			highlightIndex(index);
		}
	}

	function findPrevMatch(mode: any, search: any, flags: any) {
		if (positions.current.length === 0) {
			findAndStorePositions(mode, search, flags);
		}
		if (positions.current.length > 0) {
			let index = (currentIndex - 1 + positions.current.length) % positions.current.length;
			setCurrentIndex(index);
			highlightIndex(index);
		}
	}

	function findAndStorePositions(mode: any, search: any, flags: any) {
		positions.current = findAllMatches(mode, search, flags);
		setCurrentIndex(-1);
		if (!searchAndReplaceError && positions.current.length === 0)
			setSearchAndReplaceError(`${t('search.warningNoMatches')} ${modeLabels[mode] ?? modeLabels[0]} '${search}'`)
	}

	function handleSearchAndReplace(mode: any, search: any, flags: any, replace: any) {
		setSearchAndReplaceError(undefined)
		if (!search) return
		positions.current = findAllMatches(mode, search, flags);
		if (!searchAndReplaceError && positions.current.length === 0) {
			setSearchAndReplaceError(`${t('search.warningNoMatches')} ${modeLabels[mode] ?? modeLabels[0]} '${search}'`)
			return
		}
		setReplacedTrigger((prev: boolean) => !prev)
		const adapter = editorView?.current;
		if (!adapter) return;
		const text = adapter.getText();
		if (mode === 0) {
			const parts = positions.current.map(p => ({ from: p.start, to: p.end, insert: replace }));
			if (parts.length > 0) {
				adapter.replaceRanges(parts.reverse());
				adapter.focus();
			}
		} else if (mode === 1) {
			const gFlags = flags && !flags.includes('g') ? flags + 'g' : flags || 'g';
			try {
				let re = new RegExp(String.raw`${search}`, String.raw`${gFlags}`);
				const newVal = text.replace(re, replace.replace(/\\n/g, '\n'));
				if (newVal !== text) {
					adapter.replaceText(newVal);
					adapter.focus();
					return;
				}
			} catch (e: unknown) {
				reportError(e);
				setSearchAndReplaceError(String(e));
			}
		}
	}

	function countMatches(mode: any, search: any, flags: any) {
		setSearchAndReplaceError(undefined)
		if (!searchTerm) {
			setNumMatches(0)
			return
		}
		positions.current = findAllMatches(mode, search, flags);
		try {
			setNumMatches(positions.current.length ?? 0)
		} catch {
			setNumMatches(0)
		}
		if (positions.current.length <= currentIndex) {
			setCurrentIndex(positions.current.length - 1);
		}
	}

	useEffect(() => {
		countMatches(searchAndReplaceMode, searchTerm, searchFlags)
	}, [searchAndReplaceMode, searchTerm, searchFlags, isOpen, replacedTrigger, promptText]);

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
						onClick=${() => findPrevMatch(searchAndReplaceMode, searchTerm, searchFlags)}>
						<${SVG_ArrowUp}/>
					</button>
					<button
						class="findButton"
						title=${t('search.findNext')}
						onClick=${() => findNextMatch(searchAndReplaceMode, searchTerm, searchFlags)}>
							<${SVG_ArrowDown}/>
					</button>
					<button
						title=${t('search.replaceAllTitle')}
						disabled=${!!cancel}
						onClick=${() => handleSearchAndReplace(searchAndReplaceMode, searchTerm, searchFlags, replaceTerm)}>
							${t('search.replaceAll')}
					</button>
				</div>
				${!!searchAndReplaceError && html`
					<div style=${{margin:"8px auto"}} className="error-text">${searchAndReplaceError}</div>`}
		</${Widget}>`;
}
