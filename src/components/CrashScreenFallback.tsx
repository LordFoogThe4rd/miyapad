import { html } from 'htm/react';
import { useT } from '../i18n';
import type { FallbackProps } from 'react-error-boundary';

export function CrashScreenFallback({ error }: FallbackProps) {
  const t = useT();
  return html`
    <div id="crash-screen" role="alert">
      <h1>${t('crash.heading')}</h1>
      <p>${t('crash.descriptionPre')}<a href="https://github.com/LordFoogThe4rd/miyapad/issues/new/choose" target="_blank">${t('crash.descriptionLink')}</a>.</p>
      <pre>
        <strong>${error.message}</strong>
        <br /><br />
        ${error.stack}
      </pre>
    </div>
  `;
}
