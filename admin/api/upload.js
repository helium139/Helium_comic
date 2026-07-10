const API =
"https://helium-cms.mylengoctra06.workers.dev";

export async function uploadImage(
    file,
    folder,
    filename
){

    const form =
        new FormData();

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

    const res =
        await fetch(
            `${API}/upload`,
            {
                method:"POST",
                body:form
            }
        );

    const data =
        await res.json();

    if(!data.success){

        throw new Error(
            "Upload thất bại"
        );

    }

    return data.url;

}