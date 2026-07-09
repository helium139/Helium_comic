import {
    requireAdmin
}
from
"../assets/js/adminGuard.js";

requireAdmin();

fetch("../assets/data/data.json")

.then(r=>r.json())

.then(data=>{

const list=document.getElementById("manga-list");

Object.entries(data).forEach(([slug,manga])=>{

list.innerHTML+=`

<div class="manga-card">

<img src="${manga.cover}">

<div class="manga-info">

<h3>${manga.title}</h3>

<p>${manga.author}</p>

<p>

${manga.chapters.length}

chapters

</p>

<div class="btn-group">

<button

class="btn edit"

onclick="location.href='manga.html?id=${slug}'">

Sửa

</button>

<button

class="btn chapter"

onclick="location.href='chapter.html?id=${slug}'">

Chap

</button>

</div>

</div>

</div>

`;

});

});