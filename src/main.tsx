import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';
createRoot(document.getElementById('root')!).render(<App />);
