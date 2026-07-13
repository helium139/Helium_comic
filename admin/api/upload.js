const API = "https://helium-cms.mylengoctra06.workers.dev";

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

    const res = await fetch(

        `${API}/upload`,

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