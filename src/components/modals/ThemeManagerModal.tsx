import { html } from 'htm/react';
import { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { InputBox } from '../controls/InputBox';
import { SelectBox } from '../controls/SelectBox';
import { exportText } from '../../api/common';
import { escapeRegExp } from '../../utils/regex';
import { defaultThemes } from '../../defaults/themes';

export function ThemeManagerModal({ isOpen, closeModal, allThemes, setAllThemes, currentThemeName, setCurrentThemeName, cancel }: any) {
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
            alert("A theme with this name already exists.");
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

        const oldCss = allThemes[editingThemeName].css;
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
        let newName = "New Theme";
        let counter = 1;
        while (allThemes.hasOwnProperty(newName) || defaultThemes.hasOwnProperty(newName)) {
            newName = `New Theme ${++counter}`;
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
                    css: `html.${className} {\n\t/* Your CSS here */\n}`
                }
            };
        });
        setEditingThemeName(newName);
    };

	const handleDuplicateTheme = () => {
		let newName = `${editingThemeName} (Copy)`;
		let counter = 1;
		while (allThemes.hasOwnProperty(newName) || defaultThemes.hasOwnProperty(newName)) {
			newName = `${editingThemeName} (Copy ${++counter})`;
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
        if (!window.confirm(`Are you sure you want to delete the theme "${editingThemeName}"? This cannot be undone.`)) {
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
                    alert("Failed to import themes. Please check if you selected the right file.");
                    console.error(e);
                }
            };
            reader.readAsText(file);
        };
        fileInput.click();
    };

    const handleReAddDefaults = () => {
        if (!window.confirm("This will restore all default themes and overwrite any of your themes that share the same name. Are you sure?")) {
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
            title="Theme Editor">
            <div class="instructTemplatesImportExport">
                <button disabled=${!!cancel} onClick=${handleImportTheme}>Import Theme</button>
                <button disabled=${!!cancel || editingThemeName === 'Serif Light'} onClick=${handleExportTheme}>Export Theme</button>
                <button disabled=${!!cancel} onClick=${handleReAddDefaults}>Re-Add Defaults</button>
            </div>
            <div className="buttons instructTemplateSidebar">
                <${SelectBox}
                    label="Theme to Edit"
                    disabled=${!!cancel}
                    value=${editingThemeName}
                    onValueChange=${(val: any) => { setEditingThemeName(val); setNewThemeName(undefined); }}
                    options=${themeOptions}/>
				<button title="Duplicate Theme" disabled=${!!cancel || editingThemeName === 'Serif Light'} class="hbox-button" onClick=${handleDuplicateTheme}>Duplicate</button>
                <button title="New Theme" disabled=${!!cancel} class="hbox-button" onClick=${handleNewTheme}>New</button>
                <button title="Delete Theme" disabled=${!!cancel || editingThemeName === 'Serif Light'} class="hbox-button" onClick=${handleDeleteTheme}>Delete</button>
            </div>
            <hr/>
			<div class="instructtemplatesmodal-edits">
				<${InputBox} label="Theme Name"
					id="thememodal-name"
					readOnly=${!!cancel}
					value=${newThemeName ?? editingThemeName}
					onBlur=${(e: any) => handleThemeNameChange(e.target.value)}
					onKeyDown=${(e: any) => { if (e.key === 'Enter') e.target.blur(); }}
					onInput=${(e: any) => setNewThemeName(e.target.value)}
					onValueChange=${() => {}}
					/>
				<${InputBox} label="CSS Class Name"
					id="thememodal-classname"
					readOnly=${!!cancel}
					value=${newClassName ?? editingThemeData.className ?? ''}
					onBlur=${(e: any) => handleThemeClassNameChange(e.target.value)}
					onKeyDown=${(e: any) => { if (e.key === 'Enter') e.target.blur(); }}
					onInput=${(e: any) => setNewClassName(e.target.value)}
					onValueChange=${() => {}}
					/>
				<label class="TextArea">
					CSS
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
