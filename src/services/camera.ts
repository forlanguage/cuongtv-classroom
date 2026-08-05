import jsQR from 'jsqr';

export interface CapturedPhoto {
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
}

type BarcodeResult = { rawValue?: string };
type BarcodeDetectorLike = new (options: { formats: string[] }) => {
  detect: (source: CanvasImageSource) => Promise<BarcodeResult[]>;
};

function sourceDimensions(source: CanvasImageSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight };
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth, height: source.naturalHeight };
  if (source instanceof HTMLCanvasElement) return { width: source.width, height: source.height };
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) return { width: source.width, height: source.height };
  return { width: 0, height: 0 };
}

function decodeQrSource(source: CanvasImageSource): string | null {
  const sourceSize = sourceDimensions(source);
  if (!sourceSize.width || !sourceSize.height) return null;

  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(sourceSize.width, sourceSize.height));
  const width = Math.max(1, Math.round(sourceSize.width * scale));
  const height = Math.max(1, Math.round(sourceSize.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(source, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  const decoded = jsQR(image.data, width, height, { inversionAttempts: 'attemptBoth' });
  return decoded?.data ?? null;
}

function installBarcodeDetectorFallback(): void {
  const browserWindow = window as Window & { BarcodeDetector?: BarcodeDetectorLike };
  if (browserWindow.BarcodeDetector) return;
  browserWindow.BarcodeDetector = class BarcodeDetectorFallback {
    constructor(_options: { formats: string[] }) {}
    async detect(source: CanvasImageSource): Promise<BarcodeResult[]> {
      const value = decodeQrSource(source);
      return value ? [{ rawValue: value }] : [];
    }
  };
}

if (typeof window !== 'undefined') installBarcodeDetectorFallback();

async function loadImageFile(file: File): Promise<{ source: CanvasImageSource; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, release: () => bitmap.close() };
    } catch {
      // Older iOS/Safari builds may reject createImageBitmap for HEIC/JPEG captures.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = objectUrl;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Không thể mở ảnh QR đã chọn.'));
  });
  return { source: image, release: () => URL.revokeObjectURL(objectUrl) };
}

export async function decodeQrFromImageFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Tệp đã chọn không phải là ảnh.');
  const loaded = await loadImageFile(file);
  try {
    const decoded = decodeQrSource(loaded.source);
    if (!decoded) throw new Error('Không tìm thấy mã QR rõ ràng trong ảnh. Hãy chụp gần hơn, đủ sáng và tránh rung.');
    return decoded;
  } finally {
    loaded.release();
  }
}

async function openCamera(video: HTMLVideoElement, facingMode: 'user' | 'environment'): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Trình duyệt này không hỗ trợ truy cập camera trực tiếp.');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 720 },
      height: { ideal: 960 },
    },
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function openFrontCamera(video: HTMLVideoElement): Promise<MediaStream> {
  return openCamera(video, 'user');
}

export function openRearCamera(video: HTMLVideoElement): Promise<MediaStream> {
  return openCamera(video, 'environment');
}

export function stopCamera(stream?: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export async function captureCompressedPhoto(video: HTMLVideoElement, overlayText: string): Promise<CapturedPhoto> {
  if (!video.videoWidth || !video.videoHeight) throw new Error('Camera chưa sẵn sàng.');

  const maxWidth = 720;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Không thể xử lý ảnh camera.');
  context.drawImage(video, 0, 0, width, height);
  context.fillStyle = 'rgba(2, 6, 23, 0.72)';
  context.fillRect(0, height - 72, width, 72);
  context.fillStyle = '#ffffff';
  context.font = `${Math.max(16, Math.round(width / 34))}px sans-serif`;
  context.fillText(overlayText.slice(0, 80), 18, height - 38);
  context.font = `${Math.max(13, Math.round(width / 46))}px sans-serif`;
  context.fillText(new Date().toLocaleString('vi-VN'), 18, height - 14);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('Không thể tạo ảnh điểm danh.')),
      'image/jpeg',
      0.72,
    );
  });

  return { blob, previewUrl: URL.createObjectURL(blob), width, height };
}
