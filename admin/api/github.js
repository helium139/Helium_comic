import { authenticatedFetch } from "./authenticated-fetch.js";

async function post(path, body, requestOptions = {}){

    const res = await authenticatedFetch(

        path,

        {

            method:"POST",

            headers:{

                "Content-Type":"application/json"

            },

            body:JSON.stringify(body),

            ...requestOptions

        }

    );

    const json = await res.json();

    if(!json.success){

        throw new Error(

            json.message ||

            "Request failed."

        );

    }

    return json;

}

/* ===========================
        NEW MANGA
=========================== */

export async function newManga(manga){

    return post(

        "/new-manga",

        manga

    );

}

/* ===========================
        EDIT MANGA
=========================== */

export async function editManga(manga){

    return post(

        "/edit-manga",

        manga

    );

}

/* ===========================
        DELETE MANGA
=========================== */

export async function deleteManga(slug){

    return post(

        "/delete-manga",

        {

            slug

        }

    );

}

/* ===========================
        NEW CHAPTER
=========================== */

export async function publishChapter(data){

    return post(

        "/new-chapter",

        data

    );

}

/* ===========================
        EDIT CHAPTER
=========================== */

export async function updateChapter(data){
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
        return await post("/edit-chapter", data, { signal: controller.signal });
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error("Cập nhật chapter quá thời gian chờ. Hãy thử lưu lại; các ảnh đã tải lên sẽ được dùng lại.");
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }

}

/* ===========================
        DELETE CHAPTER
=========================== */

export async function removeChapter(

    manga,

    chapterId

){

    return post(

        "/delete-chapter",

        {

            manga,

            chapterId

        }

    );

}
/* ===========================
        RENAME IMAGES
=========================== */

export async function renameImages(data){

    return post(

        "/rename-images",

        data

    );

}