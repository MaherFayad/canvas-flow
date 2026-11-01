import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { fc } from '@flowcanvas/sdk';
import { App } from './App';
import { SCREENS } from './screens';
import '@fontsource/sorts-mill-goudy/400.css';
import '@fontsource/sorts-mill-goudy/400-italic.css';
import '@fontsource-variable/inter';
import './styles.css';

// VITE_FC_SDK=0 skips the SDK, so the canvas falls back to its fetch mock layer.
if (import.meta.env.VITE_FC_SDK !== '0') {
  fc.init({ screens: SCREENS });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
