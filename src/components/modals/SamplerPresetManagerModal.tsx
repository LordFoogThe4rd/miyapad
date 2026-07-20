import { html } from 'htm/react';
import { useState, useLayoutEffect, type FormEvent } from 'react';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';
import { InputSlider } from '../controls/InputSlider';
import { Checkbox } from '../controls/Checkbox';
import { SVG_Trash, SVG_CheckOn, SVG_CheckOff } from '../icons/index';
import { importSillyTavernPreset } from '../../importer/sillytavern';
import { importNaiPreset } from '../../importer/nai';
import { isSamplerPresetData } from '../../storage/validators';
import { useT } from '../../i18n';

type TFunc = ReturnType<typeof useT>;

const SAMPLER_TOGGLES = [
  ['temperature', 'sidebar.temperature'],
  ['dynatemp', 'sidebar.dynamicTemperature'],
  ['rep_pen', 'sidebar.repetitionPenalty'],
  ['pres_pen', 'sidebar.presencePenalty'],
  ['freq_pen', 'sidebar.frequencyPenalty'],
  ['mirostat', 'sidebar.mirostat'],
  ['xtc', 'sidebar.xtc'],
  ['dry', 'sidebar.dry'],
  ['top_k', 'sidebar.topK'],
  ['top_p', 'sidebar.topP'],
  ['min_p', 'sidebar.minP'],
  ['typical_p', 'sidebar.typicalP'],
  ['tfs_z', 'sidebar.tfsZ'],
  ['ban_tokens', 'sidebar.bannedStrings'],
] as const;

interface SamplerPresetManagerModalProps {
  isOpen: boolean;
  closeModal: () => void;
  presets: Record<string, SamplerPresetData>;
  setPresets: React.Dispatch<React.SetStateAction<Record<string, SamplerPresetData>>>;
  activePresetId: string;
}

function importPreset(json: Record<string, unknown>, existingNames: string[]): Omit<SamplerPresetData, 'id'> | null {
  if (typeof json.presetVersion === 'number') {
    return importNaiPreset(json, existingNames);
  }
  if (json.samplers !== undefined || json.sampler_priority !== undefined || json.samplers_priorities !== undefined) {
    return importSillyTavernPreset(json, existingNames);
  }
  if (isSamplerPresetData(json)) {
    const nameBase = json.name;
    let name = nameBase;
    for (let i = 1; existingNames.includes(name); i++) {
      name = nameBase + (i === 1 ? ' (Imported)' : ` (Imported ${i})`);
    }
    return { ...json, name };
  }
  return null;
}

function handleImport(
  data: unknown,
  presets: Record<string, SamplerPresetData>,
  setPresets: React.Dispatch<React.SetStateAction<Record<string, SamplerPresetData>>>,
  t: TFunc,
) {
  const entries = Array.isArray(data) ? data : [data];
  const existingNames = (Object.values(presets) as SamplerPresetData[]).map(p => p.name);
  const newPresets: Record<string, SamplerPresetData> = {};

  for (const raw of entries) {
    if (typeof raw !== 'object' || raw === null) continue;
    let imported: Omit<SamplerPresetData, 'id'> | null;
    try {
      imported = importPreset(raw as Record<string, unknown>, existingNames);
    } catch {
      continue;
    }
    if (!imported) continue;
    const id = crypto.randomUUID();
    newPresets[id] = { ...imported, id } as SamplerPresetData;
    existingNames.push(imported.name);
  }

  if (Object.keys(newPresets).length > 0) {
    setPresets(prev => ({ ...prev, ...newPresets }));
  } else {
    alert(t('samplerPreset.noValidPresets'));
  }
}

function handleImportFile(presets: Record<string, SamplerPresetData>, setPresets: React.Dispatch<React.SetStateAction<Record<string, SamplerPresetData>>>, t: TFunc) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        handleImport(data, presets, setPresets, t);
      } catch (e) {
        alert(t('samplerPreset.invalidJsonFile'));
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

async function handleImportClipboard(presets: Record<string, SamplerPresetData>, setPresets: React.Dispatch<React.SetStateAction<Record<string, SamplerPresetData>>>, t: TFunc) {
  try {
    const text = await navigator.clipboard.readText();
    const data = JSON.parse(text);
    handleImport(data, presets, setPresets, t);
  } catch {
    alert(t('samplerPreset.clipboardError'));
  }
}

function exportPreset(preset: SamplerPresetData) {
  const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = preset.name + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function exportAllPresets(presets: Record<string, SamplerPresetData>) {
  const arr = Object.values(presets);
  const blob = new Blob([JSON.stringify(arr, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sampler_presets.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function copyPresetToClipboard(preset: SamplerPresetData) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(preset, null, 2));
  } catch {}
}

export function SamplerPresetManagerModal({ isOpen, closeModal, presets, setPresets, activePresetId }: SamplerPresetManagerModalProps) {
  const t = useT();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileShowDetails, setMobileShowDetails] = useState(false);

  useLayoutEffect(() => {
    if (isOpen) {
      if (activePresetId in presets && selectedId !== activePresetId) {
        setSelectedId(activePresetId);
      } else if ((!selectedId || !(selectedId in presets)) && Object.keys(presets).length > 0) {
        setSelectedId(Object.keys(presets)[0]);
      }
      setMobileShowDetails(false);
    }
  }, [isOpen]);

  const handleNewPreset = () => {
    const newId = crypto.randomUUID();
    let counter = 1;
    let newName = t('samplerPreset.newPresetPrefix') + counter;
    const existingNames = (Object.values(presets) as SamplerPresetData[]).map(p => p.name);
    while (existingNames.includes(newName)) {
      counter++;
      newName = t('samplerPreset.newPresetPrefix') + counter;
    }
    const newPreset: SamplerPresetData = {
      id: newId,
      name: newName,
      enabled: true,
      seed: -1,
      maxPredictTokens: -1,
      temperature: 0.7,
      dynaTempRange: 0,
      dynaTempExp: 1,
      repeatPenalty: 1.1,
      repeatLastN: 256,
      penalizeNl: false,
      presencePenalty: 0,
      frequencyPenalty: 0,
      topK: 40,
      topP: 0.95,
      typicalP: 1,
      minP: 0,
      tfsZ: 1,
      mirostat: 0,
      mirostatTau: 5.0,
      mirostatEta: 0.1,
      xtcThreshold: 0.1,
      xtcProbability: 0,
      dryMultiplier: 0,
      dryBase: 1.75,
      dryAllowedLength: 2,
      dryPenaltyRange: 1024,
      drySequenceBreakers: '["\\n",":","\\"","*"]',
      bannedTokens: '[]',
      ignoreEos: false,
      enabledSamplers: [],
      grammar: '',
    };
    setPresets(prev => ({ ...prev, [newId]: newPreset }));
    setSelectedId(newId);
    setMobileShowDetails(true);
  };

  const handleClonePreset = (id: string | null) => {
    if (!id) return;
    const preset = presets[id];
    if (!preset) return;
    const newId = crypto.randomUUID();
    const newPreset = structuredClone(preset);
    newPreset.id = newId;
    const existingNames = (Object.values(presets) as SamplerPresetData[]).map(p => p.name);
    let name = preset.name + t('samplerPreset.copySuffix');
    for (let i = 1; existingNames.includes(name); i++) {
      name = preset.name + t('samplerPreset.copySuffix') + i;
    }
    newPreset.name = name;
    setPresets(prev => ({ ...prev, [newId]: newPreset }));
    setSelectedId(newId);
    setMobileShowDetails(true);
  };

  const handleDeletePreset = (id: string | null) => {
    if (!id || id === activePresetId) return;
    if (!confirm(t('samplerPreset.confirmDelete'))) return;
    setPresets(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (selectedId === id) {
      setSelectedId(null);
      setMobileShowDetails(false);
    }
  };

  const handleUpdatePreset = <K extends keyof SamplerPresetData>(id: string | null, field: K, value: SamplerPresetData[K]) => {
    if (!id) return;
    setPresets(prev => {
      if (!(id in prev)) return prev;
      return { ...prev, [id]: { ...prev[id], [field]: value } };
    });
  };

  const updateCurrentPreset = <K extends keyof SamplerPresetData>(field: K, value: SamplerPresetData[K]) => {
    handleUpdatePreset(selectedId, field, value);
  };

  const currentPreset = selectedId ? presets[selectedId] : undefined;
  const isActivePreset = selectedId === activePresetId;

  const iconBack = html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`;

  return html`
    <${Modal} isOpen=${isOpen} onClose=${closeModal}
      title=${t('samplerPreset.title')}
      description=${t('samplerPreset.description')}>

      <div className="sampler-preset-modal-layout ${mobileShowDetails ? 'mobile-show-details' : ''}">
        <div className="sampler-preset-sidebar">
          <div className="sampler-preset-sidebar-header">
            <span>${t('samplerPreset.title')}</span>
            <button onClick=${handleNewPreset} title=${t('samplerPreset.addNew')}>${t('samplerPreset.newButton')}</button>
          </div>
          <div className="sampler-preset-sidebar-actions">
            <button onClick=${() => handleImportFile(presets, setPresets, t)}>${t('samplerPreset.import')}</button>
            <button onClick=${() => handleImportClipboard(presets, setPresets, t)}>${t('samplerPreset.importClipboard')}</button>
            <button onClick=${() => exportAllPresets(presets)}>${t('samplerPreset.exportAll')}</button>
          </div>
          <div className="sampler-preset-list">
            ${(Object.entries(presets) as [string, SamplerPresetData][]).map(([id, preset]) => html`
              <div key=${id} role="button" tabIndex=${0}
                className="sampler-preset-item ${selectedId === id ? 'selected' : ''} ${preset.enabled ? 'enabled' : ''}"
                onKeyDown=${(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(id); setMobileShowDetails(true); } }}
                onClick=${() => {
                  setSelectedId(id);
                  setMobileShowDetails(true);
                }}>
                <div className="sampler-preset-item-name">${preset.name}</div>
              </div>
            `)}
          </div>
        </div>

        <div className="sampler-preset-details">
          ${currentPreset ? html`
            <div className="sampler-preset-header">
              <div className="sampler-preset-header-title">
                <div className="sampler-preset-back-btn" role="button" tabIndex=${0}
                  aria-label=${t('samplerPreset.goBack')}
                  onKeyDown=${(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMobileShowDetails(false); } }}
                  onClick=${() => setMobileShowDetails(false)}>
                  ${iconBack}
                </div>
                ${currentPreset.name}
              </div>
              <div className="sampler-preset-actions">
                <div className="sampler-preset-action-btn" role="button" tabIndex=${0}
                  style=${isActivePreset ? { opacity: '0.5', cursor: 'not-allowed' } : {}}
                  title=${isActivePreset ? t('samplerPreset.cannotDisableActive') : t('samplerPreset.toggleStatus')}
                  onKeyDown=${(e: KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && !isActivePreset) { e.preventDefault(); handleUpdatePreset(selectedId, 'enabled', !currentPreset.enabled); } }}
                  onClick=${() => {
                    if (isActivePreset) return;
                    handleUpdatePreset(selectedId, 'enabled', !currentPreset.enabled);
                  }}>
                  ${currentPreset.enabled ? html`<${SVG_CheckOn}/>` : html`<${SVG_CheckOff}/>`}
                  <span style=${{fontSize:'0.9em'}}>
                    ${currentPreset.enabled ? t('samplerPreset.enabled') : t('samplerPreset.disabled')}
                  </span>
                </div>
                <button className="sampler-preset-action-btn" onClick=${() => handleClonePreset(selectedId)} title=${t('samplerPreset.clone')}>
                  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> ${t('samplerPreset.clone')}
                </button>
                <button className="sampler-preset-action-btn" onClick=${() => exportPreset(currentPreset)} title=${t('samplerPreset.export')}>
                  ${t('samplerPreset.export')}
                </button>
                <button className="sampler-preset-action-btn" onClick=${() => copyPresetToClipboard(currentPreset)} title=${t('samplerPreset.copyToClipboard')}>
                  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
                </button>
                <button className="sampler-preset-action-btn"
                  style=${isActivePreset ? { opacity: '0.5', cursor: 'not-allowed' } : {}}
                  title=${isActivePreset ? t('samplerPreset.cannotDeleteActive') : t('samplerPreset.delete')}
                  onClick=${() => handleDeletePreset(selectedId)}>
                  <${SVG_Trash}/> ${t('samplerPreset.delete')}
                </button>
              </div>
            </div>

            <div className="sampler-preset-content-scroll">
              <${InputBox} label=${t('samplerPreset.presetName')}
                value=${currentPreset.name}
                onInput=${(e: FormEvent<HTMLInputElement>) => updateCurrentPreset('name', (e.target as HTMLInputElement).value)}
                onValueChange=${() => {}}
              />

              <div className="horz-separator"/>
              <strong>${t('samplerPreset.enabledSamplers')}</strong>
              ${SAMPLER_TOGGLES.map(([sampler, labelKey]) => html`
                <${Checkbox} key=${sampler} label=${t(labelKey)}
                  value=${currentPreset.enabledSamplers.includes(sampler)}
                  onValueChange=${(v: boolean) => updateCurrentPreset('enabledSamplers',
                    v ? [...currentPreset.enabledSamplers, sampler]
                      : currentPreset.enabledSamplers.filter(s => s !== sampler))}/>
              `)}
              <div className="horz-separator"/>

              <${InputSlider} label=${t('sidebar.temperature')} type="number" step="0.01" max="5"
                value=${currentPreset.temperature} onValueChange=${(v: number) => updateCurrentPreset('temperature', v)}/>
              <${InputSlider} label=${t('sidebar.dynaTempRange')} type="number" step="0.01"
                value=${currentPreset.dynaTempRange} onValueChange=${(v: number) => updateCurrentPreset('dynaTempRange', v)}/>
              <${InputSlider} label=${t('sidebar.dynaTempExp')} type="number" step="0.01"
                value=${currentPreset.dynaTempExp} onValueChange=${(v: number) => updateCurrentPreset('dynaTempExp', v)}/>

              <${InputSlider} label=${t('sidebar.repeatPenalty')} type="number" step="0.01" min="1" max="3"
                value=${currentPreset.repeatPenalty} onValueChange=${(v: number) => updateCurrentPreset('repeatPenalty', v)}/>
              <${InputSlider} label=${t('sidebar.repPenRange')} type="number" step="1" max="65536"
                value=${currentPreset.repeatLastN} onValueChange=${(v: number) => updateCurrentPreset('repeatLastN', v)}/>
              <${Checkbox} label=${t('sidebar.penalizeNl')} value=${currentPreset.penalizeNl}
                onValueChange=${(v: boolean) => updateCurrentPreset('penalizeNl', v)}/>

              <${InputSlider} label=${t('sidebar.presencePenalty')} type="number" step="0.01" min="-2" max="2"
                value=${currentPreset.presencePenalty} onValueChange=${(v: number) => updateCurrentPreset('presencePenalty', v)}/>
              <${InputSlider} label=${t('sidebar.frequencyPenalty')} type="number" step="0.01" min="-2" max="2"
                value=${currentPreset.frequencyPenalty} onValueChange=${(v: number) => updateCurrentPreset('frequencyPenalty', v)}/>

              <${InputSlider} label=${t('sidebar.mirostat')} type="number" step="1" min="0" max="2"
                value=${currentPreset.mirostat} onValueChange=${(v: number) => updateCurrentPreset('mirostat', v)}/>
              <${InputSlider} label=${t('sidebar.mirostatTau')} type="number" step="0.01" max="20"
                value=${currentPreset.mirostatTau} onValueChange=${(v: number) => updateCurrentPreset('mirostatTau', v)}/>
              <${InputSlider} label=${t('sidebar.mirostatEta')} type="number" step="0.01" max="1"
                value=${currentPreset.mirostatEta} onValueChange=${(v: number) => updateCurrentPreset('mirostatEta', v)}/>

              <${InputSlider} label=${t('sidebar.xtcThreshold')} type="number" step="0.01" max="0.5"
                value=${currentPreset.xtcThreshold} onValueChange=${(v: number) => updateCurrentPreset('xtcThreshold', v)}/>
              <${InputSlider} label=${t('sidebar.xtcProbability')} type="number" step="0.01" max="1"
                value=${currentPreset.xtcProbability} onValueChange=${(v: number) => updateCurrentPreset('xtcProbability', v)}/>

              <${InputSlider} label=${t('sidebar.dryMultiplier')} type="number" step="0.01" max="5"
                value=${currentPreset.dryMultiplier} onValueChange=${(v: number) => updateCurrentPreset('dryMultiplier', v)}/>
              <${InputSlider} label=${t('sidebar.dryBase')} type="number" step="0.01" min="1" max="4"
                value=${currentPreset.dryBase} onValueChange=${(v: number) => updateCurrentPreset('dryBase', v)}/>
              <${InputSlider} label=${t('sidebar.allowedLength')} type="number" step="1" max="20"
                value=${currentPreset.dryAllowedLength} onValueChange=${(v: number) => updateCurrentPreset('dryAllowedLength', v)}/>
              <${InputSlider} label=${t('sidebar.penaltyRange')} type="number" step="1" max="65536"
                value=${currentPreset.dryPenaltyRange} onValueChange=${(v: number) => updateCurrentPreset('dryPenaltyRange', v)}/>
              <${InputBox} label=${t('sidebar.drySequenceBreakers')} type="text"
                value=${currentPreset.drySequenceBreakers}
                onValueChange=${(v: string) => updateCurrentPreset('drySequenceBreakers', v)}/>

              <${InputSlider} label=${t('sidebar.topK')} type="number" step="1" max="200"
                value=${currentPreset.topK} onValueChange=${(v: number) => updateCurrentPreset('topK', v)}/>
              <${InputSlider} label=${t('sidebar.topP')} type="number" step="0.01" max="1"
                value=${currentPreset.topP} onValueChange=${(v: number) => updateCurrentPreset('topP', v)}/>
              <${InputSlider} label=${t('sidebar.minP')} type="number" step="0.01" max="1"
                value=${currentPreset.minP} onValueChange=${(v: number) => updateCurrentPreset('minP', v)}/>
              <${InputSlider} label=${t('sidebar.typicalP')} type="number" step="0.01" max="1"
                value=${currentPreset.typicalP} onValueChange=${(v: number) => updateCurrentPreset('typicalP', v)}/>
              <${InputSlider} label=${t('sidebar.tfsZ')} type="number" step="0.01" max="1"
                value=${currentPreset.tfsZ} onValueChange=${(v: number) => updateCurrentPreset('tfsZ', v)}/>

              <${InputBox} label=${t('sidebar.bannedStringsJson')} type="text"
                value=${currentPreset.bannedTokens}
                onValueChange=${(v: string) => updateCurrentPreset('bannedTokens', v)}/>
              <${InputBox} label=${t('sidebar.grammar')} type="text"
                value=${currentPreset.grammar}
                onValueChange=${(v: string) => updateCurrentPreset('grammar', v)}/>
              <${Checkbox} label=${t('sidebar.ignoreEos')} value=${currentPreset.ignoreEos}
                onValueChange=${(v: boolean) => updateCurrentPreset('ignoreEos', v)}/>

              <${InputBox} label=${t('sidebar.seed')} type="text" inputmode="numeric"
                value=${currentPreset.seed}
                onValueChange=${(v: string | number) => updateCurrentPreset('seed', Number(v))}/>
              <${InputBox} label=${t('sidebar.maxPredictTokens')} type="text" inputmode="numeric"
                value=${currentPreset.maxPredictTokens}
                onValueChange=${(v: string | number) => updateCurrentPreset('maxPredictTokens', Number(v))}/>
            </div>
          ` : html`
            <div className="sampler-preset-empty">
              ${t('samplerPreset.emptyState')}
            </div>
          `}
        </div>
      </div>
    </${Modal}>
  `;
}
