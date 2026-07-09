import {
    requireAdmin
}
from "../assets/js/adminGuard.js";

await requireAdmin();

let mangas = {};
let currentSlug = null;

// ================= LOAD DATA =================

fetch("../assets/data/data.json")
.then(res => res.json())
.then(data=>{

    mangas = data;

    renderSidebar();

});


// ================= SIDEBAR =================

function renderSidebar(keyword=""){

    const sidebar =
        document.getElementById("mangaSidebar");

    sidebar.innerHTML = "";

    Object.entries(mangas)

    .filter(([slug,manga])=>{

        return manga.title
            .toLowerCase()
            .includes(keyword.toLowerCase());

    })

    .sort((a,b)=>

        a[1].title.localeCompare(b[1].title)

    )

    .forEach(([slug,manga])=>{

        sidebar.innerHTML += `

        <div
            class="manga-row"
            data-id="${slug}">

            <img
                src="${manga.cover}"
                class="manga-cover">

            <div class="manga-info">

                <h4>

                    ${manga.title}

                </h4>

                <p>

                    ${manga.chapters.length}
                    Chapters

                </p>

            </div>

        </div>

        `;

    });

}


// ================= SEARCH =================

document
.getElementById("search")
.addEventListener(

    "input",

    function(){

        renderSidebar(
            this.value
        );

    }

);


// ================= CLICK =================

document.addEventListener(

    "click",

    e=>{

        const row =
            e.target.closest(".manga-row");

        if(!row) return;

        openEditor(
            row.dataset.id
        );

    }

);


// ================= EDITOR =================

function openEditor(slug){

    currentSlug = slug;

    const manga =
        mangas[slug];

    const editor =
        document.getElementById(
            "mangaEditor"
        );

    editor.innerHTML = `

<h2>

${manga.title}

</h2>

<div class="editor-grid">

<div>

<label>

Cover

</label>

<input
id="cover"
value="${manga.cover}">

</div>

<div>

<label>

Slug

</label>

<input
id="slug"
value="${slug}">

</div>

<div>

<label>

Tên truyện

</label>

<input
id="title"
value="${manga.title}">

</div>

<div>

<label>

Tên gốc

</label>

<input
id="original"
value="${manga.original_title}">

</div>

<div>

<label>

Tác giả

</label>

<input
id="author"
value="${manga.author}">

</div>

<div>

<label>

Team

</label>

<input
id="team"
value="${manga.team}">

</div>

<div>

<label>

Status

</label>

<select id="status">

<option
${manga.status==="Ongoing"?"selected":""}>
Ongoing
</option>

<option
${manga.status==="Completed"?"selected":""}>
Completed
</option>

</select>

</div>

<div>

<label>

Admin Pick

</label>

<input
type="checkbox"
id="pick"
${manga.adminPick?"checked":""}>

</div>

<div>

<label>

Pick Order

</label>

<input
type="number"
id="pickOrder"
value="${manga.pickOrder||0}">

</div>

<div style="grid-column:1/3">

<label>

Tags

</label>

<input
id="tags"
value="${manga.tags.join(", ")}">

</div>

<div style="grid-column:1/3">

<label>

Description

</label>

<textarea
id="description"
rows="8">

${manga.description}

</textarea>

</div>

</div>

<hr>

<h3>

Chapter

</h3>

<div id="chapterList">

${renderChapterTable(manga)}

</div>

<br>

<button id="saveBtn">

💾 Lưu

</button>

<button id="chapterBtn">

➕ Add Chapter

</button>

`;

}


// ================= CHAPTER =================

function renderChapterTable(manga){

    let html="";

    manga.chapters.forEach(chap=>{

        html+=`

<div class="chapter-row">

<div>

${chap.title}

</div>

<div>

${chap.createAt.split("T")[0]}

</div>

<div>

${chap.pages}
Trang

</div>

</div>

`;

    });

    return html;

}


// ================= NEW =================

document
.getElementById("newBtn")
.addEventListener(

    "click",

    ()=>{

        document
        .getElementById("mangaEditor")
        .innerHTML=

`

<h2>

Thêm truyện mới

</h2>

<p>

(Chức năng sẽ làm ở bước tiếp)

</p>
`;

    }

);