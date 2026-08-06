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

type Crop = { x: number; y: number; width: number; height: number };

function sourceDimensions(source: CanvasImageSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight };
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth, height: source.naturalHeight };
  if (source instanceof HTMLCanvasElement) return { width: source.width, height: source.height };
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) return { width: source.width, height: source.height };
  return { width: 0, height: 0 };
}

function decodeCanvas(canvas: HTMLCanvasElement): string | null {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || !canvas.width || !canvas.height) return null;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(image.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

function renderCandidate(source: CanvasImageSource, crop: Crop, rotation: 0 | 90 | 180 | 270, maxDimension: number): HTMLCanvasElement {
  const scale = Math.min(1, maxDimension / Math.max(crop.width, crop.height));
  const drawnWidth = Math.max(1, Math.round(crop.width * scale));
  const drawnHeight = Math.max(1, Math.round(crop.height * scale));
  const swap = rotation === 90 || rotation === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? drawnHeight : drawnWidth;
  canvas.height = swap ? drawnWidth : drawnHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return canvas;

  context.save();
  if (rotation === 90) {
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    context.translate(canvas.width, canvas.height);
    context.rotate(Math.PI);
  } else if (rotation === 270) {
    context.translate(0, canvas.height);
    context.rotate(-Math.PI / 2);
  }
  context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, drawnWidth, drawnHeight);
  context.restore();
  return canvas;
}

function centeredCrop(width: number, height: number, ratio: number): Crop {
  const cropWidth = Math.max(1, Math.round(width * ratio));
  const cropHeight = Math.max(1, Math.round(height * ratio));
  return {
    x: Math.round((width - cropWidth) / 2),
    y: Math.round((height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  };
}

function decodeQrSource(source: CanvasImageSource): string | null {
  const size = sourceDimensions(source);
  if (!size.width || !size.height) return null;

  const full: Crop = { x: 0, y: 0, width: size.width, height: size.height };
  const crops = [full, centeredCrop(size.width, size.height, 0.86), centeredCrop(size.width, size.height, 0.68)];
  const rotations: Array<0 | 90 | 180 | 270> = [0, 90, 270, 180];

  for (const maxDimension of [2400, 1600]) {
    for (const crop of crops) {
      for (const rotation of rotations) {
        const decoded = decodeCanvas(renderCandidate(source, crop, rotation, maxDimension));
        if (decoded) return decoded;
      }
    }
  }
  return null;
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
    image.onerror = () => reject(new Error('Không thể mở ảnh QR đã chọn. Hãy dùng ảnh JPEG hoặc PNG.'));
  });
  return { source: image, release: () => URL.revokeObjectURL(objectUrl) };
}

export async function decodeQrFromImageFile(file: File): Promise<string> {
  const imageLike = file.type.startsWith('image/') || /\.(heic|heif|jpg|jpeg|png|webp)$/i.test(file.name);
  if (!imageLike) throw new Error('Tệp đã chọn không phải là ảnh QR được hỗ trợ.');
  const loaded = await loadImageFile(file);
  try {
    const decoded = decodeQrSource(loaded.source);
    if (!decoded) throw new Error('Chưa đọc được QR. Giữ toàn bộ mã trong khung, chụp gần hơn, tránh phản sáng rồi thử lại.');
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
      width: { ideal: 1280 },
      height: { ideal: 1280 },
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
