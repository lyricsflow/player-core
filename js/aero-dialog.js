import { openModal, closeModal } from 'https://nurislamaibekuly.github.io/aeroui/src/components/modal/modal.js';

let dialogContainer = null;

function ensureContainer() {
  if (!dialogContainer) {
    dialogContainer = document.createElement('div');
    dialogContainer.id = 'aero-dialog-host';
    document.body.appendChild(dialogContainer);
  }
  return dialogContainer;
}

/**
 * Creates and displays an AeroUI Alert modal dialog.
 * @param {string|{title?: string, message: string, okText?: string}} options
 * @returns {Promise<void>}
 */
export function aeroAlert(options) {
  return new Promise((resolve) => {
    const opts = typeof options === 'string' ? { message: options } : options;
    const title = opts.title || 'Alert';
    const message = opts.message || '';
    const okText = opts.okText || 'OK';

    const container = ensureContainer();
    const dialog = document.createElement('dialog');
    dialog.className = 'aero-modal aero-alert-dialog';
    dialog.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: #fff;">${escapeHTML(title)}</h3>
        <p style="margin: 0; font-size: 0.95rem; line-height: 1.45; color: rgba(235, 235, 245, 0.85);">${escapeHTML(message)}</p>
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px;">
          <button type="button" class="aero-btn aero-btn-primary" data-action="ok" style="min-width: 80px; padding: 9px 18px; border-radius: 12px; background: #fff; color: #000; font-weight: 600; border: none; cursor: pointer; transition: transform 0.15s ease;">
            ${escapeHTML(okText)}
          </button>
        </div>
      </div>
    `;

    container.appendChild(dialog);
    openModal(dialog);

    const cleanup = () => {
      closeModal(dialog);
      setTimeout(() => dialog.remove(), 250);
    };

    const okBtn = dialog.querySelector('[data-action="ok"]');
    okBtn.focus();
    okBtn.onclick = () => {
      cleanup();
      resolve();
    };

    dialog.addEventListener('cancel', () => {
      cleanup();
      resolve();
    });
  });
}

/**
 * Creates and displays an AeroUI Confirmation modal dialog.
 * @param {string|{title?: string, message: string, confirmText?: string, cancelText?: string, isDestructive?: boolean}} options
 * @returns {Promise<boolean>}
 */
export function aeroConfirm(options) {
  return new Promise((resolve) => {
    const opts = typeof options === 'string' ? { message: options } : options;
    const title = opts.title || 'Confirm';
    const message = opts.message || '';
    const confirmText = opts.confirmText || 'OK';
    const cancelText = opts.cancelText || 'Cancel';
    const isDestructive = !!opts.isDestructive;

    const container = ensureContainer();
    const dialog = document.createElement('dialog');
    dialog.className = 'aero-modal aero-confirm-dialog';
    const confirmBg = isDestructive ? '#ff3b30' : '#fff';
    const confirmColor = isDestructive ? '#fff' : '#000';

    dialog.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: #fff;">${escapeHTML(title)}</h3>
        <p style="margin: 0; font-size: 0.95rem; line-height: 1.45; color: rgba(235, 235, 245, 0.85);">${escapeHTML(message)}</p>
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;">
          <button type="button" class="aero-btn secondary" data-action="cancel" style="padding: 9px 18px; border-radius: 12px; background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.15); font-weight: 500; cursor: pointer;">
            ${escapeHTML(cancelText)}
          </button>
          <button type="button" class="aero-btn primary" data-action="confirm" style="padding: 9px 18px; border-radius: 12px; background: ${confirmBg}; color: ${confirmColor}; border: none; font-weight: 600; cursor: pointer;">
            ${escapeHTML(confirmText)}
          </button>
        </div>
      </div>
    `;

    container.appendChild(dialog);
    openModal(dialog);

    let resolved = false;
    const cleanup = () => {
      closeModal(dialog);
      setTimeout(() => dialog.remove(), 250);
    };

    const confirmBtn = dialog.querySelector('[data-action="confirm"]');
    const cancelBtn = dialog.querySelector('[data-action="cancel"]');

    confirmBtn.onclick = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(true);
    };

    cancelBtn.onclick = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(false);
    };

    dialog.addEventListener('cancel', () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(false);
    });
  });
}

/**
 * Creates and displays an AeroUI Prompt modal dialog with an AeroUI text input.
 * @param {string|{title?: string, message?: string, placeholder?: string, defaultValue?: string, confirmText?: string, cancelText?: string}} options
 * @returns {Promise<string|null>}
 */
export function aeroPrompt(options) {
  return new Promise((resolve) => {
    const opts = typeof options === 'string' ? { message: options } : options;
    const title = opts.title || 'Input';
    const message = opts.message || '';
    const placeholder = opts.placeholder || 'Type here...';
    const defaultValue = opts.defaultValue || '';
    const confirmText = opts.confirmText || 'Done';
    const cancelText = opts.cancelText || 'Cancel';

    const container = ensureContainer();
    const dialog = document.createElement('dialog');
    dialog.className = 'aero-modal aero-prompt-dialog';
    dialog.innerHTML = `
      <form method="dialog" style="display: flex; flex-direction: column; gap: 14px; margin: 0;">
        <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: #fff;">${escapeHTML(title)}</h3>
        ${message ? `<p style="margin: 0; font-size: 0.95rem; line-height: 1.4; color: rgba(235, 235, 245, 0.85);">${escapeHTML(message)}</p>` : ''}
        
        <label class="aero-field" style="margin-top: 4px;">
          <input type="text" class="aero-input" id="aero-prompt-val" placeholder="${escapeHTML(placeholder)}" autocomplete="off" value="${escapeHTML(defaultValue)}">
          <span class="aero-field-label">${escapeHTML(placeholder)}</span>
        </label>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;">
          <button type="button" class="aero-btn secondary" data-action="cancel" style="padding: 9px 18px; border-radius: 12px; background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.15); font-weight: 500; cursor: pointer;">
            ${escapeHTML(cancelText)}
          </button>
          <button type="submit" class="aero-btn primary" data-action="confirm" style="padding: 9px 18px; border-radius: 12px; background: #fff; color: #000; border: none; font-weight: 600; cursor: pointer;">
            ${escapeHTML(confirmText)}
          </button>
        </div>
      </form>
    `;

    container.appendChild(dialog);
    openModal(dialog);

    const input = dialog.querySelector('#aero-prompt-val');
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);

    let settled = false;
    const cleanup = () => {
      closeModal(dialog);
      setTimeout(() => dialog.remove(), 250);
    };

    const form = dialog.querySelector('form');
    form.onsubmit = (e) => {
      e.preventDefault();
      if (settled) return;
      settled = true;
      const val = input.value;
      cleanup();
      resolve(val);
    };

    const cancelBtn = dialog.querySelector('[data-action="cancel"]');
    cancelBtn.onclick = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    };

    dialog.addEventListener('cancel', () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    });
  });
}

function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
