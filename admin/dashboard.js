import {
    requireAdmin
}
from
"../assets/js/adminGuard.js";

await requireAdmin();

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
<div class="card">

<img src="${manga.cover}">

<div class="card-body">

<h2>${manga.title}</h2>

<p>${manga.original_title}</p>

<p>${manga.author}</p>

<p>

${manga.chapters.length}

chapters

</p>

<p>

${manga.status}

</p>

<div class="card-buttons">

<button>Edit</button>

<button>Chapter</button>

</div>

</div>

</div>

`;

}