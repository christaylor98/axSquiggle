import '@fontsource/kalam/latin-400.css';
import '@fontsource/kalam/latin-ext-400.css';
import './ui/style.css';
import { startApp } from './ui/app';

startApp();

const ver = document.getElementById('ver'); if (ver) { ver.textContent = __BUILD__.split(' ')[0]; ver.title = `Build ${__BUILD__}. If this is not the latest, reload with Ctrl+Shift+R.`; }
