// Canvas encoders are feature-tested by their output MIME type. Fail closed on errors.
export const MAX_CHAPTER_JPEG_CONVERSION_SIZE = 5 * 1024 * 1024;

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
    if (['jpg', 'jpeg'].includes(extension) && maxJpegConversionSize !== undefined &&
        file.size > maxJpegConversionSize && header[0] === 255 && header[1] === 216 && header[2] === 255) {
        return { file, filename: filename.replace(/\.jpeg$/i, '.jpg'), reason: 'oversized-jpeg' };
    }
    // Canvas drops EXIF orientation. Retain these originals rather than rotate/mirror them.
    if (header[0] === 255 && header[1] === 216 && await hasOrientation(file)) return { file, filename, reason: 'exif-orientation' };
    // Do not flatten animation merely because somebody gave it a JPG filename.
    if (signature.startsWith('GIF8') || (signature.startsWith('RIFF') && signature.slice(8) === 'WEBP')) return { file, filename, reason: 'passthrough-signature' };
    // APNG must keep its animation, just like GIF.
    if (extension === 'png' || (header[0] === 137 && signature.slice(1, 4) === 'PNG')) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const view = new DataView(bytes.buffer);
        for (let offset = 8; offset + 12 <= bytes.length;) {
            const length = view.getUint32(offset);
            if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'acTL') return { file, filename, reason: 'animated-png' };
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
        canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        if (!canvas.width || !canvas.height) throw new Error('Empty image');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        context.drawImage(bitmap, 0, 0);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (!blob || !blob.size) throw new Error('WebP conversion failed');
        const candidate = { type: blob.type, size: blob.size };
        if (blob.type !== 'image/webp') return { file, filename, candidate, reason: 'encoder-unsupported' };
        if (blob.size >= file.size) return { file, filename, candidate, reason: 'not-smaller' };
        return { file: blob, filename: filename.replace(/\.[^.]+$/, '.webp'), candidate, reason: 'converted' };
    } finally {
        bitmap?.close?.();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (canvas) canvas.width = canvas.height = 0;
    }
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
