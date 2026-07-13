const API = "https://helium-cms.mylengoctra06.workers.dev";

/* ===========================
        NEW MANGA
=========================== */

export async function newManga(manga){

    const res = await fetch(

        `${API}/new-manga`,

        {

            method:"POST",

            headers:{

                "Content-Type":"application/json"

            },

            body:JSON.stringify(manga)

        }

    );

    return await res.json();

}

/* ===========================
        EDIT MANGA
=========================== */

export async function editManga(manga){

    const res = await fetch(

        `${API}/edit-manga`,

        {

            method:"POST",

            headers:{

                "Content-Type":"application/json"

            },

            body:JSON.stringify(manga)

        }

    );

    return await res.json();

}

/* ===========================
        DELETE MANGA
=========================== */

export async function deleteManga(slug){

    const res = await fetch(

        `${API}/delete-manga`,

        {

            method:"POST",

            headers:{

                "Content-Type":"application/json"

            },

            body:JSON.stringify({

                slug

            })

        }

    );

    return await res.json();

}

/* ===========================
        NEW CHAPTER
=========================== */

export async function publishChapter(data){

    const res = await fetch(

        `${API}/new-chapter`,

        {

            method:"POST",

            headers:{

                "Content-Type":"application/json"

            },

            body:JSON.stringify(data)

        }

    );

    return await res.json();

}