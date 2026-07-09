import {
    requireAdmin
}
from
"../assets/js/adminGuard.js";

requireAdmin();

let mangas = {};

fetch("../assets/data/data.json")

.then(r=>r.json())

.then(data=>{

    mangas = data;

    renderList();

});

function renderList(){

    const list =
    document.getElementById("manga-list");

    list.innerHTML = "";

    Object.entries(mangas)

    .forEach(([slug,manga])=>{

        list.innerHTML += `

        <div
            class="manga-item"
            data-id="${slug}">

            ${manga.title}

        </div>

        `;

    });

    document
    .querySelectorAll(".manga-item")

    .forEach(item=>{

        item.onclick=()=>{

            openEditor(
                item.dataset.id
            );

        };

    });

}

function openEditor(slug){

    const manga =
        mangas[slug];

    document.getElementById(
        "editor-title"
    ).innerHTML =
        manga.title;

    document.getElementById(
        "editor"
    ).innerHTML =

`
<label>Slug</label>

<input
id="slug"
value="${slug}">


<label>Tên truyện</label>

<input
id="title"
value="${manga.title}">


<label>Tác giả</label>

<input
id="author"
value="${manga.author}">


<label>Team</label>

<input
id="team"
value="${manga.team}">


<label>Cover</label>

<input
id="cover"
value="${manga.cover}">


<label>Mô tả</label>

<textarea
id="description">

${manga.description}

</textarea>


<button id="saveBtn">

Lưu thay đổi

</button>

`;

}