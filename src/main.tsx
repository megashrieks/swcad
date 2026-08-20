import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DialogHost } from './ui/Dialog';
import { ThemeProvider } from './ui/theme';
import { TooltipProvider } from './ui/pomavo';
import './ui/pomavo/globals.css';
import './ui/theme.css';

const host = document.getElementById('root');
if (!host) throw new Error('missing #root');

createRoot(host).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <App />
        <DialogHost />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
