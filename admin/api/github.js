const API =
"https://helium-cms.mylengoctra06.workers.dev";

export async function publishChapter(
    payload
){

    const res =
        await fetch(

            `${API}/new-chapter`,

            {

                method:"POST",

                headers:{
                    "Content-Type":
                    "application/json"
                },

                body:
                JSON.stringify(payload)

            }

        );

    return await res.json();

}