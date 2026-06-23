import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Register service worker
const updateSW = registerSW({
  onNeedRefresh() {
    const lastUpdateAttempt = sessionStorage.getItem('pwa_update_attempt');
    const now = Date.now();
    
    // Éviter de boucler indéfiniment sur les invites de mise à jour s'il y a eu une tentative récente (< 45 secondes)
    if (lastUpdateAttempt && now - parseInt(lastUpdateAttempt, 10) < 45000) {
      console.log('Mise à jour de l\'application détectée à nouveau, mais ignorée temporairement pour éviter de boucler.');
      return;
    }

    if (confirm('Une nouvelle version de l\'application est disponible. Voulez-vous mettre à jour pour appliquer les dernières nouveautés ?')) {
      sessionStorage.setItem('pwa_update_attempt', Date.now().toString());
      updateSW(true);
    }
  },
  onOfflineReady() {
    console.log('L\'application est prête pour une utilisation hors ligne.');
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
