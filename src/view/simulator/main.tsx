import { render } from 'solid-js/web';

function Simulator() {
  return <h1>Batch plant simulator</h1>;
}

const root = document.getElementById('app');
if (root === null) throw new Error('The page template has no #app element.');
render(() => <Simulator />, root);
