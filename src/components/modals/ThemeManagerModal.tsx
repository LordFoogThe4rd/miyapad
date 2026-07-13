import { html } from 'htm/react';
import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';
import { SelectBox } from '../controls/SelectBox';
import { exportText } from '../../api/common';
import { escapeRegExp } from '../../utils/regex';
import { defaultThemes } from '../../defaults/themes';
import { useT } from '../../i18n';

interface ThemeManagerModalProps {
  isOpen: boolean;
  closeModal: () => void;
  allThemes: Record<string, ThemeData>;
  setAllThemes: Dispatch<SetStateAction<Record<string, ThemeData>>>;
  currentThemeName: string;
  setCurrentThemeName: Dispatch<SetStateAction<string>>;
  cancel: (() => void) | null;
}

export function ThemeManagerModal({ isOpen, closeModal, allThemes, setAllThemes, currentThemeName, setCurrentThemeName, cancel }: ThemeManagerModalProps) {
    const t = useT();
    const [editingThemeName, setEditingThemeName] = useState(currentThemeName);
    const [newThemeName, setNewThemeName] = useState<string | undefined>(undefined);
    const [newClassName, setNewClassName] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (isOpen) {
			let themeToEdit = currentThemeName;
            if (themeToEdit === 'Serif Light') {
                const themeKeys = Object.keys(allThemes);
                themeToEdit = themeKeys.length > 0 ? themeKeys[0] : 'Serif Light';
            }
            setEditingThemeName(themeToEdit);
            setNewThemeName(undefined);
        }
    }, [isOpen, currentThemeName]);

    const handleThemeNameChange = (newName: any) => {
        const trimmedNewName = newName.trim();
        if (trimmedNewName === editingThemeName || !trimmedNewName) {
            setNewThemeName(undefined);
            return;
        }
        if (allThemes.hasOwnProperty(trimmedNewName)) {
            alert(t('themeManager.duplicateNameError'));
            setNewThemeName(undefined);
            return;
        }

        setAllThemes((prevThemes: any) => {
            const newThemes = { ...prevThemes };
            const theme = newThemes[editingThemeName];
            if (!theme) return prevThemes;
            delete newThemes[editingThemeName];
            newThemes[trimmedNewName] = { ...theme };
            return newThemes;
        });

        if (currentThemeName === editingThemeName) {
            setCurrentThemeName(trimmedNewName);
        }
        setEditingThemeName(trimmedNewName);
        setNewThemeName(undefined);
    };

    const handleThemeClassNameChange = (newClassName: any) => {
        const oldClassName = allThemes[editingThemeName]?.className;
        const sanitizedClassName = newClassName.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');

        if (!sanitizedClassName || sanitizedClassName === oldClassName) {
            setNewClassName(undefined);
            return;
        }

        const oldCss = allThemes[editingThemeName]?.css ?? '';
        const regex = new RegExp(`\\.${escapeRegExp(oldClassName)}(?=[\\s,{]|$)`, 'g');
        const newCss = oldCss.replace(regex, `.${sanitizedClassName}`);

        setAllThemes((prevThemes: any) => {
            const newThemes = { ...prevThemes };
            const theme = newThemes[editingThemeName];
            if (!theme) return prevThemes;
            newThemes[editingThemeName] = {
                ...theme,
                className: sanitizedClassName,
                css: newCss
            };
            return newThemes;
        });
        setNewClassName(undefined);
    };

    const handleThemeCssChange = (newCss: any) => {
        setAllThemes((prevThemes: any) => {
            const newThemes = { ...prevThemes };
            const theme = newThemes[editingThemeName];
            if (!theme) return prevThemes;
            newThemes[editingThemeName] = { ...theme, css: newCss };
            return newThemes;
        });
    };

    const handleNewTheme = () => {
        let newName = t('themeManager.newThemeDefaultName');
        let counter = 1;
        while (allThemes.hasOwnProperty(newName) || defaultThemes.hasOwnProperty(newName)) {
            newName = `${t('themeManager.newThemeDefaultName')} ${++counter}`;
        }
		const className = newName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        setAllThemes((prevThemes: any) => {
            const maxOrder = Math.max(0, ...Object.values(prevThemes).map((t: any) => t.order ?? 0));
            return {
                ...prevThemes,
                [newName]: {
                    order: maxOrder + 1,
                    isDefault: false,
                    className: className,
                    css: `html.${className} {\n\t/* ${t('themeManager.yourCssHere')} */\n}`
                }
            };
        });
        setEditingThemeName(newName);
    };

	const handleDuplicateTheme = () => {
		let newName = `${editingThemeName}${t('themeManager.copySuffix')}`;
		let counter = 1;
		while (allThemes.hasOwnProperty(newName) || defaultThemes.hasOwnProperty(newName)) {
			newName = `${editingThemeName}${t('themeManager.copySuffixNum')}${++counter})`;
		}

		setAllThemes((prevThemes: any) => {
			const theme = prevThemes[editingThemeName];
			if (!theme) return prevThemes;
			const maxOrder = Math.max(0, ...Object.values(prevThemes).map((t: any) => t.order ?? 0));
			return {
				...prevThemes,
				[newName]: {
					...theme,
					order: maxOrder + 1,
					isDefault: false,
				},
			};
		});
		setEditingThemeName(newName);
	};

    const handleDeleteTheme = () => {
        if (!window.confirm(t('themeManager.deleteConfirm', { name: editingThemeName }))) {
            return;
        }

        setAllThemes((prevThemes: any) => {
            const newThemes = { ...prevThemes };
            delete newThemes[editingThemeName];

			const newThemeKeys = Object.keys(newThemes);
			const nextTheme = newThemeKeys.length > 0 ? newThemeKeys[0] : 'Serif Light';
			if (currentThemeName === editingThemeName) {
				setCurrentThemeName(nextTheme);
			}
			setEditingThemeName(nextTheme);

            return newThemes;
        });
        
    };

    const handleExportTheme = () => {
        if (editingThemeName === 'Serif Light') {
            return;
        }
        const themeToExport = { [editingThemeName]: allThemes[editingThemeName] };
        exportText(`miyapad_theme_${editingThemeName.replace(/\s+/g, '_')}.json`, JSON.stringify(themeToExport, null, 2));
    };

    const handleImportTheme = () => {
        const fileInput = document.createElement("input");
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.onchange = (e: any) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e: any) => {
                try {
                    const importedThemes = JSON.parse((e.target as FileReader).result as string);
                    setAllThemes((prevThemes: any) => ({ ...prevThemes, ...importedThemes }));
                } catch (e: unknown) {
                    alert(t('themeManager.importError'));
                    console.error(e);
                }
            };
            reader.readAsText(file);
        };
        fileInput.click();
    };

    const handleReAddDefaults = () => {
        if (!window.confirm(t('themeManager.reAddDefaultsConfirm'))) {
            return;
        }
        setAllThemes((prevThemes: any) => ({
            ...prevThemes,
            ...defaultThemes
        }));
    };

    const editingThemeData = allThemes[editingThemeName] || {};
    const themeOptions = [
        ...Object.keys(allThemes).map(name => ({ name, value: name }))
    ];

    return html`
        <${Modal} isOpen=${isOpen} onClose=${closeModal}
            title=${t('themeManager.title')}>
            <div class="instructTemplatesImportExport">
                <button disabled=${!!cancel} onClick=${handleImportTheme}>${t('themeManager.importTheme')}</button>
                <button disabled=${!!cancel || editingThemeName === 'Serif Light'} onClick=${handleExportTheme}>${t('themeManager.exportTheme')}</button>
                <button disabled=${!!cancel} onClick=${handleReAddDefaults}>${t('themeManager.reAddDefaults')}</button>
            </div>
            <div className="buttons instructTemplateSidebar">
                <${SelectBox}
                    label=${t('themeManager.themeToEdit')}
                    disabled=${!!cancel}
                    value=${editingThemeName}
                    onValueChange=${(val: any) => { setEditingThemeName(val); setNewThemeName(undefined); }}
                    options=${themeOptions}/>
				<button title=${t('themeManager.duplicateTitle')} disabled=${!!cancel || editingThemeName === 'Serif Light'} class="hbox-button" onClick=${handleDuplicateTheme}>${t('themeManager.duplicate')}</button>
                <button title=${t('themeManager.newTitle')} disabled=${!!cancel} class="hbox-button" onClick=${handleNewTheme}>${t('themeManager.new')}</button>
                <button title=${t('themeManager.deleteTitle')} disabled=${!!cancel || editingThemeName === 'Serif Light'} class="hbox-button" onClick=${handleDeleteTheme}>${t('themeManager.delete')}</button>
            </div>
            <hr/>
			<div class="instructtemplatesmodal-edits">
				<${InputBox} label=${t('themeManager.themeName')}
					id="thememodal-name"
					readOnly=${!!cancel}
					value=${newThemeName ?? editingThemeName}
					onBlur=${(e: any) => handleThemeNameChange(e.target.value)}
					onKeyDown=${(e: any) => { if (e.key === 'Enter') e.target.blur(); }}
					onInput=${(e: any) => setNewThemeName(e.target.value)}
					onValueChange=${() => {}}
					/>
				<${InputBox} label=${t('themeManager.cssClassName')}
					id="thememodal-classname"
					readOnly=${!!cancel}
					value=${newClassName ?? editingThemeData.className ?? ''}
					onBlur=${(e: any) => handleThemeClassNameChange(e.target.value)}
					onKeyDown=${(e: any) => { if (e.key === 'Enter') e.target.blur(); }}
					onInput=${(e: any) => setNewClassName(e.target.value)}
					onValueChange=${() => {}}
					/>
				<label class="TextArea">
					${t('themeManager.css')}
					<textarea
						readOnly=${!!cancel}
						value=${editingThemeData.css || ''}
						onInput=${(e: any) => handleThemeCssChange(e.target.value)}
						class="wi-textarea"
						style=${{ height: '30vh', fontFamily: 'monospace' }}
						/>
				</label>
			</div>
        </${Modal}>`;
}
