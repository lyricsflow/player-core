import { showToast as aeroShowToast } from 'https://nurislamaibekuly.github.io/aeroui/src/components/toast/toast.js';

const DEFAULT_DURATION = 5000;

function showToast(options = {}) {
  if (typeof options === 'string') options = { message: options };
  return aeroShowToast({ duration: DEFAULT_DURATION, ...options });
}

export { showToast };
