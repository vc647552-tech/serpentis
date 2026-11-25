import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { snakeCoreWasm } from './wasm/snakeCoreWasm';

void snakeCoreWasm.preload().then(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});
