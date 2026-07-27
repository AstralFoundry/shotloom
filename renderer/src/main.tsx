import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactWorkbench } from './app/ReactWorkbench';
import '../styles.css';
import '../styles/settings.css';
import '../styles/react-migration.css';

const container = document.getElementById('app');
if (!container) throw new Error('Shotloom renderer root is missing');
createRoot(container).render(<StrictMode><ReactWorkbench/></StrictMode>);
