import { authenticatedFetch } from "./authenticated-fetch.js";

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

    const res = await authenticatedFetch(

        "/upload",

        {

            method:"POST",

            body:form

        }

    );

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
