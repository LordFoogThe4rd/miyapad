import { useLayoutEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useGeneration } from '../contexts/GenerationContext';

export function useTTS() {
	const { ttsEnabled, setTTSEnabled, ttsVoiceId, ttsPitch, ttsRate, ttsVolume, ttsSpeakInputs, ttsMaxUserInput } = useSettings();
	const { ttsAvailable, setTTSAvailable, ttsNewText, ttsLastChunk, ttsQueue, ttsVoices, ttsPaused, promptChunks } = useGeneration();

	useLayoutEffect(() => {
		if (!window.speechSynthesis) {
			setTTSAvailable(false);
			setTTSEnabled(false);
			return;
		}
		
		window.speechSynthesis.onvoiceschanged = () => {
			const voices = window.speechSynthesis.getVoices();
			ttsVoices.current = voices;
		};
		setTTSAvailable(true);
		
		return () => {
			window.speechSynthesis.onvoiceschanged = null;
		};
	}, []);

	async function ttsProcessQueue() {
		if (ttsEnabled && ttsQueue.current.length > 0) {
			if (window.speechSynthesis.speaking)
				window.speechSynthesis.cancel();
			var text = ttsQueue.current.shift().trim();
			// Remove special tokens (anything between <> and [])
			text = text.replaceAll(/\<.+?\>/g, "");
			text = text.replaceAll(/\[.+?\]/g, "");
			// Remove asterisks
			text = text.replaceAll("*", "");
			var utterance = new SpeechSynthesisUtterance(text);
			utterance.voice = ttsVoices.current[ttsVoiceId];
			utterance.pitch = ttsPitch;
			utterance.rate = ttsRate;
			utterance.volume = ttsVolume;
			utterance.addEventListener("end", (event) => ttsProcessQueue());
			window.speechSynthesis.speak(utterance);
		}
	}

	function ttsStop() {
		if (!ttsEnabled)
			return;
		ttsPaused.current = true;
		ttsQueue.current = [];
		window.speechSynthesis.cancel();
	}

	function ttsPushUserInput() {
		if (!ttsSpeakInputs || !ttsEnabled)
			return;
		if (promptChunks.length > 0 && promptChunks[promptChunks.length - 1].type == 'user') {
			var textToRead = "";
			let text = promptChunks[promptChunks.length - 1].content;
			// Limit user input
			let words = text.split(/(?<=[ \n])/);
			if (words.length > ttsMaxUserInput) {
				text = words.slice(-ttsMaxUserInput).join('');
			}
			// Split string using punctuation
			var strings = text.split(/(?<=[!\.\?\n])/);
			for (var s in strings) {
				if (s == strings.length -1 && !/[!\.\?\n]/.test(strings[s].slice(-1))) {
					// Put unterminated sentence in ttsNewText instead
					ttsNewText.current += strings[s];
				} else if (/[0-9a-zÀ-ÿ]/.test(strings[s]))	// Make sure it contains at least one pronounceable character
					textToRead += strings[s];
			}
			if (textToRead.length > 0 && !ttsPaused.current)
				ttsQueue.current.push(textToRead);
			if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) ttsProcessQueue();
		}
	}

	function ttsAddChunk(text) {
		if (!ttsEnabled)
			return;
		ttsNewText.current += text;
		var last = text.slice(-1);
		if (text.slice(-3) == "..." || (last == "." && !/(Ms|Mr|Mrs)/.test(ttsLastChunk.current.slice(-3))) || last == "!" || last == "\n" || last == "?" || last == "\u{2026}") {
			if (/[0-9a-zÀ-ÿ]/.test(ttsNewText.current)) {
				if (!ttsPaused.current)
					ttsQueue.current.push(ttsNewText.current);
				ttsNewText.current = "";
				ttsLastChunk.current = "";
				if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) ttsProcessQueue();
			}
		} else {
			ttsLastChunk.current = text;
		}
	}

	function listTTSVoices() {
		const voices = [];
		for (var v = 0; v < ttsVoices.current.length; v++) {
			voices[v] = { name: ttsVoices.current[v].name, value: v }
		}
		return voices;
	}
	return { ttsProcessQueue, ttsStop, ttsPushUserInput, ttsAddChunk, listTTSVoices };
}
