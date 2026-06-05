import './style.css';
import { startTocContent } from '../../src/content.js';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  registration: 'runtime',
  cssInjectionMode: 'manual',
  runAt: 'document_idle',
  main(ctx) {
    startTocContent(ctx);
  },
});
