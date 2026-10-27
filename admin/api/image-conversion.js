// Canvas encoders are feature-tested by their output MIME type. Fail closed on errors.
export const MAX_CHAPTER_JPEG_CONVERSION_SIZE = 2 * 1024 * 1024;

const MAX_SAFE_CANVAS_DIMENSION = 16_384;
const MAX_SAFE_CANVAS_PIXELS = 16_777_216;

export async function prepareImage(file, filename, quality = 0.85, { maxJpegConversionSize } = {}) {
    try {
        return await convertImage(file, filename, quality, maxJpegConversionSize);
    } catch {
        throw new Error(`Image conversion failed: ${file.name || filename}`);
    }
}

async function convertImage(file, filename, quality, maxJpegConversionSize) {
    const extension = filename.split('.').pop().toLowerCase();
    if (!['jpg', 'jpeg', 'png'].includes(extension)) return { file, filename, reason: 'passthrough' };
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const signature = String.fromCharCode(...header);
    const isJpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
    const jpegExtension = ['jpg', 'jpeg'].includes(extension);
    const originalFilename = jpegExtension ? filename.replace(/\.jpeg$/i, '.jpg') : filename;
    const preserve = reason => ({ file, filename: originalFilename, reason });
    if (jpegExtension && maxJpegConversionSize !== undefined && file.size > maxJpegConversionSize && isJpeg) {
        return preserve('oversized-jpeg');
    }
    let sourceDimensions;
    if (isJpeg) {
        sourceDimensions = await readJpegDimensions(file);
        if (!sourceDimensions || !isSafeCanvasDimensions(sourceDimensions.width, sourceDimensions.height)) {
            return preserve('unsafe-canvas-dimensions');
        }
    }
    // Canvas drops EXIF orientation. Retain these originals rather than rotate/mirror them.
    if (isJpeg && await hasOrientation(file)) return preserve('exif-orientation');
    // Do not flatten animation merely because somebody gave it a JPG filename.
    if (signature.startsWith('GIF8') || (signature.startsWith('RIFF') && signature.slice(8) === 'WEBP')) return preserve('passthrough-signature');
    // APNG must keep its animation, just like GIF.
    if (extension === 'png' || (header[0] === 137 && signature.slice(1, 4) === 'PNG')) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const view = new DataView(bytes.buffer);
        for (let offset = 8; offset + 12 <= bytes.length;) {
            const length = view.getUint32(offset);
            if (offset + 12 + length > bytes.length) break;
            if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'acTL') return preserve('animated-png');
            offset += 12 + length;
        }
    }
    let bitmap, objectUrl, canvas;
    try {
        if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(file, { imageOrientation: 'none' });
        else {
            objectUrl = URL.createObjectURL(file);
            bitmap = await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('Cannot decode image'));
                image.src = objectUrl;
            });
        }
        if (!isSafeCanvasDimensions(bitmap.width, bitmap.height) ||
            (sourceDimensions && (bitmap.width !== sourceDimensions.width || bitmap.height !== sourceDimensions.height))) {
            return preserve('unsafe-canvas-dimensions');
        }
        let context;
        try {
            canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
                return preserve('unsafe-canvas-dimensions');
            }
            context = canvas.getContext('2d');
            if (!context) {
                if (isJpeg) return preserve('unsafe-canvas-dimensions');
                throw new Error('Canvas unavailable');
            }
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        } catch (error) {
            if (isJpeg) return preserve('unsafe-canvas-dimensions');
            throw error;
        }
        let blob;
        try {
            blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        } catch (error) {
            if (isJpeg) return preserve('unsafe-canvas-dimensions');
            throw error;
        }
        if (!blob || !blob.size) {
            if (isJpeg) return preserve('unsafe-canvas-dimensions');
            throw new Error('WebP conversion failed');
        }
        const candidate = { type: blob.type, size: blob.size };
        if (blob.type !== 'image/webp') return { ...preserve('encoder-unsupported'), candidate };
        if (blob.size >= file.size) return { ...preserve('not-smaller'), candidate };
        return { file: blob, filename: filename.replace(/\.[^.]+$/, '.webp'), candidate, reason: 'converted' };
    } finally {
        bitmap?.close?.();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (canvas) canvas.width = canvas.height = 0;
    }
}

function isSafeCanvasDimensions(width, height) {
    return Number.isInteger(width) && Number.isInteger(height) &&
        width > 0 && height > 0 &&
        width <= MAX_SAFE_CANVAS_DIMENSION && height <= MAX_SAFE_CANVAS_DIMENSION &&
        width * height <= MAX_SAFE_CANVAS_PIXELS;
}

async function readJpegDimensions(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] !== 255 || bytes[1] !== 216) return null;

    for (let offset = 2; offset + 1 < bytes.length;) {
        if (bytes[offset] !== 255) return null;
        while (bytes[offset] === 255) offset++;
        const marker = bytes[offset++];
        if (marker === 0xda || marker === 0xd9) return null;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (offset + 2 > bytes.length) return null;

        const length = bytes[offset] * 256 + bytes[offset + 1];
        if (length < 2 || offset + length > bytes.length) return null;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
            if (length < 8) return null;
            const height = bytes[offset + 3] * 256 + bytes[offset + 4];
            const width = bytes[offset + 5] * 256 + bytes[offset + 6];
            return { width, height };
        }
        offset += length;
    }
    return null;
}

async function hasOrientation(file) {
    for (let offset = 2; offset + 4 <= file.size;) {
        const marker = new Uint8Array(await file.slice(offset, offset + 4).arrayBuffer());
        if (marker[0] !== 255 || [0xda, 0xd9].includes(marker[1])) break;
        const length = marker[2] * 256 + marker[3];
        if (length < 2 || offset + length + 2 > file.size) break;
        if (marker[1] === 0xe1) {
            const bytes = new Uint8Array(await file.slice(offset + 4, offset + 2 + length).arrayBuffer());
            if (String.fromCharCode(...bytes.subarray(0, 6)) === 'Exif\0\0') {
                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                const little = view.getUint16(6) === 0x4949;
                const directory = 6 + view.getUint32(10, little);
                const count = view.getUint16(directory, little);
                for (let i = 0; i < count; i++) {
                    const tag = directory + 2 + i * 12;
                    if (view.getUint16(tag, little) === 0x112 && view.getUint16(tag + 8, little) !== 1) return true;
                }
            }
        }
        offset += length + 2;
    }
    return false;
}
