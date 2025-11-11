// Expose Lightweight Charts as a global without using eval or Function constructor
// This uses the ESM build which is CSP/SES-friendly.
import * as LWC from 'https://cdn.jsdelivr.net/npm/lightweight-charts@4/dist/lightweight-charts.esm.production.js';

// Attach to window for existing code that expects `window.LightweightCharts`
// Note: defining on window is allowed under typical CSP without unsafe-eval.
// If `window` is frozen by SES, this assignment may fail; wrap in try/catch.
try {
  // Prefer not to overwrite if already present
  if (!('LightweightCharts' in window)) {
    // Provide the same shape as the UMD global
    window.LightweightCharts = LWC;
  }
} catch (_) {
  // Silent: in hardened environments, fall back to direct ES imports (not used here)
}
