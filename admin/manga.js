import {
    requireAdmin
}
from
"../assets/js/adminGuard.js";

requireAdmin();

let mangas={};

fetch("../assets/data/data.json")

.then(r=>r.json())

.then(data=>{

mangas=data;

renderSidebar();

});

function renderSidebar(){

const sidebar=document.getElementById("mangaSidebar");

sidebar.innerHTML="";

Object.entries(mangas)

.sort((a,b)=>

a[1].title.localeCompare(b[1].title)

)

.forEach(([slug,manga])=>{

sidebar.innerHTML+=`

<div

class="manga-row"

data-id="${slug}"

>

${manga.title}

</div>

`;

});

}

document

.addEventListener(

"click",

e=>{

if(

e.target.classList.contains(

"manga-row"

)

){

openManga(

e.target.dataset.id

);

}

}

);