const API =
"https://helium-cms.mylengoctra06.workers.dev";

export async function uploadImage(

    file,

    manga,

    chapter,

    filename

){

    const form = new FormData();

    form.append(

        "file",

        file

    );

    form.append(

        "folder",

        `${manga}/chap${chapter}`

    );

    form.append(

        "filename",

        filename

    );

    const res =

    await fetch(

        API+"/upload",

        {

            method:"POST",

            body:form

        }

    );

    const data =

    await res.json();

    if(!data.success){

        throw new Error(

            data.message ||

            "Upload thất bại"

        );

    }

    return data.url;

}