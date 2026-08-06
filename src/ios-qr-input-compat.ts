import './ios-qr-input-compat.css';

let previewUrl = '';

function clearPreview(): void {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = '';
  document.querySelectorAll('[data-qr-image-preview]').forEach((node) => node.remove());
}

function attachQrInput(input: HTMLInputElement): void {
  if (input.dataset.qrCompatAttached === 'true') return;
  if (input.type !== 'file' || input.accept !== 'image/*' || input.getAttribute('capture') !== 'environment') return;

  input.dataset.qrCompatAttached = 'true';
  input.removeAttribute('capture');

  const controls = input.parentElement?.querySelector('.attendance-controls');
  const trigger = controls?.querySelector('button');
  if (trigger && trigger.textContent?.includes('Chụp / chọn ảnh QR')) {
    trigger.textContent = 'Chọn hoặc chụp ảnh QR';
  }

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    clearPreview();
    if (!file) return;

    previewUrl = URL.createObjectURL(file);
    const preview = document.createElement('figure');
    preview.dataset.qrImagePreview = 'true';
    preview.className = 'qr-image-preview-card';

    const image = document.createElement('img');
    image.src = previewUrl;
    image.alt = 'Ảnh QR vừa chọn';
    image.className = 'photo-preview qr-image-preview';

    const caption = document.createElement('figcaption');
    caption.textContent = 'Ảnh QR vừa chọn. Nếu chưa nhận dạng được, hãy chụp gần hơn và giữ trọn mã trong khung.';

    preview.append(image, caption);
    input.insertAdjacentElement('afterend', preview);
  }, { capture: true });
}

function scanInputs(): void {
  document.querySelectorAll<HTMLInputElement>('input[type="file"][accept="image/*"][capture="environment"]')
    .forEach(attachQrInput);
}

const observer = new MutationObserver(scanInputs);
observer.observe(document.documentElement, { childList: true, subtree: true });
scanInputs();

window.addEventListener('pagehide', clearPreview);
