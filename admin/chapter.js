import {
requireAdmin
}
from "../assets/js/adminGuard.js";

await requireAdmin();

let mangas = {};

fetch("../assets/data/data.json")

.then(r=>r.json())

.then(data=>{

    mangas=data;

    loadManga();

});

function loadManga(){

const select=document.getElementById("mangaSelect");

Object.entries(mangas)

.sort((a,b)=>

a[1].title.localeCompare(b[1].title)

)

.forEach(([slug,manga])=>{

select.innerHTML+=`

<option value="${slug}">

${manga.title}

</option>

`;

});

}

document
.getElementById("generateBtn")
.onclick=generateJson;

function generateJson(){

const id=
Number(
document.getElementById("chapterId").value
);

const title=
document.getElementById("chapterTitle").value;

const date=
document.getElementById("chapterDate").value;

const folder=
document.getElementById("chapterFolder").value;

const pages=
Number(
document.getElementById("pageCount").value
);

const json=

`{
    "id":${id},
    "title":"${title}",
    "createAt":"${date}T07:00:00Z",
    "folder":"${folder}",
    "pages":${pages}
},`;

document.getElementById("jsonOutput").value=json;

}