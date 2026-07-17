const API = "https://helium-cms.mylengoctra06.workers.dev";

async function post(path, body){

    const res = await fetch(

        `${API}${path}`,

        {

            method:"POST",

            headers:{

                "Content-Type":"application/json"

            },

            body:JSON.stringify(body)

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

    return post(

        "/edit-chapter",

        data

    );

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