import { authenticatedFetch } from "./authenticated-fetch.js";
import { MAX_CHAPTER_JPEG_CONVERSION_SIZE, prepareImage } from "./image-conversion.js";

// Temporary opt-in diagnostics: set window.HELIUM_WEBP_DEBUG = true in the CMS console.
// Only file metadata and public object keys are logged, never request headers or tokens.
function traceUpload(details) {
    if (globalThis.HELIUM_WEBP_DEBUG === true) console.info('[Helium WebP upload]', details);
}

function traceConversion(original, prepared) {
    traceUpload({ stage: 'conversion',
        original: { name: original.name, type: original.type, size: original.size },
        candidate: prepared.candidate,
        result: { name: prepared.filename, type: prepared.file.type, size: prepared.file.size },
        decision: prepared.reason === 'converted' ? 'webp' : 'original', reason: prepared.reason
    });
}

/*
    Upload bất kỳ file nào lên R2

    Ví dụ:

    uploadImage(file,"tro-tan","cover.webp")

    uploadImage(file,"tro-tan/chap5","1.webp")
*/

export async function uploadImage(

    file,

    folder,

    filename,

    { onProgress = () => {} } = {}

){

    const sourceName = file.name || filename;
    const chapter = folder.includes('/');
    await onProgress('converting');
    const prepared = await prepareImage(file, chapter ? filename : file.name, chapter ? 0.85 : 0.88,
        chapter ? { maxJpegConversionSize: MAX_CHAPTER_JPEG_CONVERSION_SIZE } : undefined);
    traceConversion(file, prepared);
    if (chapter && ['oversized-jpeg', 'unsafe-canvas-dimensions'].includes(prepared.reason) &&
        /\.jpg$/i.test(prepared.filename)) {
        await onProgress('preserved', { filename: prepared.filename, reason: prepared.reason });
    }
    await onProgress('converted');
    file = prepared.file;
    filename = chapter ? prepared.filename : `cover.${prepared.filename.split('.').pop().toLowerCase()}`;
    const form = new FormData();

    form.append(

        "file",

        file,
        filename

    );

    traceUpload({ stage: 'upload', folder, filename, type: file.type, size: file.size });

    form.append(

        "folder",

        folder

    );

    form.append(

        "filename",

        filename

    );

    let res;
    try { res = await authenticatedFetch(

        "/upload",

        {

            method:"POST",

            body:form

        }

    ); } catch { throw new Error(`Image upload failed: ${sourceName}`); }

    const json = await res.json();

    if(!json.success){

        throw new Error(

            json.message ||

            "Upload thất bại."

        );

    }

    traceUpload({ stage: 'uploaded', key: json.key, url: json.url });
    await onProgress('uploaded');
    return json.url;

}
// New manga do not yet have an authorized R2 prefix. Only the Worker chooses a staging key.
export async function stageMangaCover(file) {
    const prepared = await prepareImage(file, file.name, 0.88);
    traceConversion(file, prepared);
    file = prepared.file;
    const form = new FormData();
    form.append("file", file, prepared.filename);
    form.append("kind", "new-manga-cover");
    traceUpload({ stage: 'staging-upload', filename: prepared.filename, type: file.type, size: file.size });
    const response = await authenticatedFetch("/upload", { method: "POST", body: form });
    const json = await response.json();
    if (!json.success || typeof json.stagingRef !== "string") {
        throw new Error(json.message || "Không thể tải ảnh bìa tạm thời.");
    }
    return json.stagingRef;
}
