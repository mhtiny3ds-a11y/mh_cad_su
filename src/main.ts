import './style.css';
import { App } from './ui/app';
import type { MhcadApi } from './core/api';

declare global {
  interface Window {
    mhcad: MhcadApi;
  }
}

const app = new App(document.getElementById('app')!);
app.mount();
window.mhcad = app.api;
