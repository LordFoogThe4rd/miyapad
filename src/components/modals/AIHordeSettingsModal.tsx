import { html } from 'htm/react';
import { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';
import { SVG_ShowKey, SVG_HideKey } from '../icons/index';
import { normalizeEndpoint } from '../../api/common';
import { API_AI_HORDE } from '../../constants';
import type { SessionStorage } from '../../storage/SessionStorage';

interface AIHordeSettingsModalProps {
  isOpen: boolean;
  closeModal: () => void;
  endpoint: string;
  endpointAPIKey: string;
  setEndpointAPIKey: React.Dispatch<React.SetStateAction<string>>;
  isMiyapadEndpoint: boolean;
  sessionStorage: SessionStorage;
  endpointModel: string;
  setEndpointModel: React.Dispatch<React.SetStateAction<string>>;
  cancel: unknown;
}

export function AIHordeSettingsModal({ isOpen, closeModal, endpoint, endpointAPIKey, setEndpointAPIKey, isMiyapadEndpoint, sessionStorage, endpointModel, setEndpointModel, cancel }: AIHordeSettingsModalProps) {
    const [models, setModels] = useState<AIHordeModel[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [localSelected, setLocalSelected] = useState<string[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
	const [showKey, setShowKey] = useState(false);

    const fetchModels = async (acSignal: any) => {
        setLoading(true);
        setError(null);
        try {
            const hordeEndpoint = normalizeEndpoint(endpoint, API_AI_HORDE);
            const res = await fetch(`${isMiyapadEndpoint ? sessionStorage.proxyEndpoint : hordeEndpoint}/v2/status/models?type=text`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...(isMiyapadEndpoint ? { 'X-Real-URL': hordeEndpoint } : {})
                },
                signal: acSignal,
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const modelData = (await res.json()).filter((model: any) => model.type === "text");
            modelData.sort((a: any, b: any) => b.count - a.count || a.eta - b.eta); // Sort by workers, then ETA
            setModels(modelData);
        } catch (e: unknown) {
            if ((e as Error).name !== 'AbortError') {
                setError(String(e));
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
			setLocalSelected(endpointModel ? endpointModel.split(',').map((s: any) => s.trim()).filter(Boolean) : []);
            const ac = new AbortController();
            fetchModels(ac.signal);
            return () => ac.abort();
        }
    }, [isOpen]);

    const handleSelect = (modelName: any) => {
        setLocalSelected((prev: any) => {
            const newSelection = new Set(prev);
            if (newSelection.has(modelName)) {
                newSelection.delete(modelName);
            } else {
                newSelection.add(modelName);
            }
            return Array.from(newSelection) as string[];
        });
    };

    const handleOk = () => {
        setEndpointModel(localSelected.join(', '));
        closeModal();
    };

    const filteredModels = models.filter((model: any) => model.name.toLowerCase().includes(searchTerm.toLowerCase()));

    return html`
        <${Modal} isOpen=${isOpen} onClose=${closeModal} title="AI Horde Settings" style=${{width: '50em', 'max-height': '90vh'}}>
            <div className="vbox" style=${{gap: '1em'}}>
                <div>The AI Horde is a service that generates text using crowdsourced GPUs. Avoid sending privacy sensitive information.
					<a href="https://aihorde.net/faq" target="_blank" rel="noopener noreferrer" style=${{marginLeft: '8px'}}>More Info</a>
				</div>

				<div className="hbox-flex" style=${{flexWrap: "unset"}}>
					<${InputBox} label="Your AI Horde API Key" type=${showKey ? 'text' : 'password'}
						readOnly=${!!cancel}
						placeholder="Enter a key (or leave empty for anonymous use)"
						value=${endpointAPIKey}
						onValueChange=${setEndpointAPIKey}/>
					<button title=${showKey ? "Hide API Key" : "Show API Key"}
						className="eye-button"
						disabled=${!!cancel}
						onClick=${() => setShowKey(!showKey)}>
						${!showKey ? html`<${SVG_ShowKey}/>` : html`<${SVG_HideKey}/>`}
					</button>
				</div>
                <a href="https://aihorde.net/register" target="_blank" rel="noopener noreferrer">Need a Key? (Register New User)</a>

                <hr />

				<div class="modal-title" style=${{fontSize: '125%'}}>Select Models</div>
                <div className="hbox">
                    <${InputBox} label="Search Models" value=${searchTerm} onValueChange=${setSearchTerm} placeholder="Filter models..."/>
                    <button onClick=${() => fetchModels(new AbortController().signal)} disabled=${loading}>
                        ${loading ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>
                ${error && html`<div class="error-text">${error}</div>`}
                <div className="overflow-container" style=${{maxHeight: '45vh', background: 'var(--color-bg-popover-1)', borderRadius: '4px'}}>
                    ${loading && !models.length ? html`<div style=${{padding: '1em'}}>Loading models...</div>` : ''}
                    ${filteredModels.map((model: any) => html`
                        <div key=${model.name} className="horde-model-entry" onClick=${() => handleSelect(model.name)}>
							<div class="model-header">
								<input type="checkbox" checked=${localSelected.includes(model.name)} readOnly/>
								<div className="model-name" title=${model.name}>${model.name}</div>
							</div>
                            <div className="model-stats">
                                <span>ETA: ${model.eta}s</span>
                                <span>Queue: ${model.queued}</span>
                                <span>Workers: ${model.count}</span>
                            </div>
                        </div>
                    `)}
					${!loading && !filteredModels.length && html`<div style=${{padding: '1em'}}>No models found.</div>`}
                </div>
                <div className="buttons">
                    <button onClick=${handleOk}>OK</button>
                    <button onClick=${closeModal}>Cancel</button>
                </div>
            </div>
        </${Modal}>`;
}
