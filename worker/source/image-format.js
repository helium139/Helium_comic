// Inspect bytes rather than trusting multipart filenames or MIME declarations.
export function imageFormat(bytes) {
    const text = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
    if (bytes.length >= 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return ['webp', 'image/webp'];
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['jpg', 'image/jpeg'];
    if (bytes.length >= 8 && bytes[0] === 137 && text(1, 8) === 'PNG\r\n\x1a\n') return ['png', 'image/png'];
    if (['GIF87a', 'GIF89a'].includes(text(0, 6))) return ['gif', 'image/gif'];
    if (text(4, 8) === 'ftyp' && ['avif', 'avis'].includes(text(8, 12))) return ['avif', 'image/avif'];
    return null;
}
