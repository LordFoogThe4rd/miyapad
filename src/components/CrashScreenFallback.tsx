import { html } from 'htm/react';
import { useT } from '../i18n';
import type { FallbackProps } from 'react-error-boundary';

/** Reloads with `?safe`, which starts Miyapad without running any plugins. */
function reloadWithoutPlugins() {
  const url = new URL(window.location.href);
  url.searchParams.set('safe', '');
  window.location.assign(url);
}

export function CrashScreenFallback({ error }: FallbackProps) {
  const t = useT();
  return html`
    <div id="crash-screen" role="alert">
      <h1>${t('crash.heading')}</h1>
      <p>${t('crash.descriptionPre')}<a href="https://github.com/LordFoogThe4rd/miyapad/issues/new/choose" target="_blank">${t('crash.descriptionLink')}</a>.</p>
      <p><button onClick=${reloadWithoutPlugins}>${t('crash.reloadWithoutPlugins')}</button></p>
      <pre>
        <strong>${error.message}</strong>
        <br /><br />
        ${error.stack}
      </pre>
    </div>
  `;
}
