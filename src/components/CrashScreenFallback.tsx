import { html } from 'htm/react';

export function CrashScreenFallback({ error }) {
  return html`
    <div id="crash-screen" role="alert">
      <h1>Oops! Something went wrong.</h1>
      <p>Miyapad has encountered a fatal error and cannot continue. If possible, please copy the text below and create an issue on the <a href="https://github.com/LordFoogThe4rd/miyapad/issues/new/choose" target="_blank">GitHub repository</a>.</p>
      <pre>
        <strong>${error.message}</strong>
        <br /><br />
        ${error.stack}
      </pre>
    </div>
  `;
}
