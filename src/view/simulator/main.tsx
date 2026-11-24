import { render } from 'solid-js/web';
import { App } from './App.tsx';
import { startRuntime } from './runtime.ts';

/** The seed of the measurement noise. Any fixed value works; a fixed one makes every page load replay alike. */
const noiseSeed = 200;

const root = document.getElementById('app');
if (root === null) throw new Error('The page template has no #app element.');
const runtime = startRuntime(noiseSeed);
render(() => <App runtime={runtime} />, root);
