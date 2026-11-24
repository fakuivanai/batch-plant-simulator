import { render } from 'solid-js/web';
import { App } from './App.tsx';
import { attachToServer } from './attach.ts';
import { startLocalRuntime } from './runtime.ts';

/** The seed of the measurement noise. Any fixed value works; a fixed one makes every page load replay alike. */
const noiseSeed = 200;

const root = document.getElementById('app');
if (root === null) throw new Error('The page template has no #app element.');
const app = root;

// Opened from the server with ?attach, the page shows the server's
// simulation; opened as a file, it runs its own.
if (new URLSearchParams(window.location.search).has('attach')) {
  app.textContent = 'Connecting to the simulation server…';
  void attachToServer().then((runtime) => {
    app.textContent = '';
    render(() => <App runtime={runtime} />, app);
  });
} else {
  render(() => <App runtime={startLocalRuntime(noiseSeed)} />, app);
}
