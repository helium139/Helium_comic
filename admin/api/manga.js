const API =
"https://helium-cms.mylengoctra06.workers.dev";

export async function getMangas(){

    const res =
        await fetch(
            `${API}/mangas`
        );

    if(!res.ok){

        throw new Error(
            "Không tải được danh sách truyện"
        );

    }

    return await res.json();

}