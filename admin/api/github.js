const API =
"https://helium-cms.mylengoctra06.workers.dev";

export async function publishChapter(data){

    const res =

    await fetch(

        API+"/new-chapter",

        {

            method:"POST",

            headers:{

                "Content-Type":

                "application/json"

            },

            body:JSON.stringify(data)

        }

    );

    return await res.json();

}