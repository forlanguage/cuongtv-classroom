export interface CapturedPhoto {
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
}

async function openCamera(
  video: HTMLVideoElement,
  facingMode: 'user' | 'environment',
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Trình duyệt này không hỗ trợ truy cập camera trực tiếp.');
  }

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

export async function captureCompressedPhoto(
  video: HTMLVideoElement,
  overlayText: string,
): Promise<CapturedPhoto> {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('Camera chưa sẵn sàng.');
  }

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

  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    width,
    height,
  };
}
