import { authenticatedFetch } from "./authenticated-fetch.js";
import { prepareImage } from "./image-conversion.js";

/*
    Upload bất kỳ file nào lên R2

    Ví dụ:

    uploadImage(file,"tro-tan","cover.webp")

    uploadImage(file,"tro-tan/chap5","1.webp")
*/

export async function uploadImage(

    file,

    folder,

    filename

){

    const sourceName = file.name || filename;
    const chapter = folder.includes('/');
    const prepared = await prepareImage(file, chapter ? filename : file.name, chapter ? 0.85 : 0.88);
    file = prepared.file;
    filename = chapter ? prepared.filename : `cover.${prepared.filename.split('.').pop().toLowerCase()}`;
    const form = new FormData();

    form.append(

        "file",

        file

    );

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

    return json.url;

}
// New manga do not yet have an authorized R2 prefix. Only the Worker chooses a staging key.
export async function stageMangaCover(file) {
    file = (await prepareImage(file, file.name, 0.88)).file;
    const form = new FormData();
    form.append("file", file);
    form.append("kind", "new-manga-cover");
    const response = await authenticatedFetch("/upload", { method: "POST", body: form });
    const json = await response.json();
    if (!json.success || typeof json.stagingRef !== "string") {
        throw new Error(json.message || "Không thể tải ảnh bìa tạm thời.");
    }
    return json.stagingRef;
}
