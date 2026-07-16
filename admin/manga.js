import { requireAdmin } from "../assets/js/adminGuard.js";

import { getMangas } from "./api/manga.js";
import { uploadImage } from "./api/upload.js";

import {

    newManga,

    editManga,

    deleteManga

}

from "./api/github.js";

requireAdmin();

let mangas = {};

let currentSlug = null;

let coverFile = null;

let currentTags = [];

const tagInput =
document.getElementById("tagInput");

const tagList =
document.getElementById("tagList");

const mangaGrid =
document.getElementById("mangaGrid");

const searchInput =
document.getElementById("searchInput");

const newBtn =
document.getElementById("newMangaBtn");

const editor =
document.getElementById("editor");

const closeEditor =
document.getElementById("closeEditor");

const saveBtn =
document.getElementById("saveBtn");

const deleteBtn =
document.getElementById("deleteBtn");

const editorTitle =
document.getElementById("editorTitle");

const slug =
document.getElementById("slug");

const title =
document.getElementById("title");

const originalTitle =
document.getElementById("originalTitle");

const author =
document.getElementById("author");

const status =
document.getElementById("status");

const tags =
document.getElementById("tags");

const description =
document.getElementById("description");

const coverFileInput =
document.getElementById("coverFile");

const coverPreview =
document.getElementById("coverPreview");

const teamSelect =
document.getElementById("team");

const teams =
await fetch("../assets/data/teams.json")
.then(r=>r.json());

teamSelect.innerHTML="";

teams.forEach(team=>{

    teamSelect.innerHTML+=`
        <option>${team}</option>
    `;

});

const chapterList =
document.getElementById("chapterList");

const chapterModal =
document.getElementById("chapterModal");

const addChapterBtn =
document.getElementById("addChapterBtn");

const saveChapterBtn =
document.getElementById("saveChapterBtn");

const closeChapterBtn =
document.getElementById("closeChapterBtn");

const chapterId =
document.getElementById("chapterId");

const chapterName =
document.getElementById("chapterName");

const chapterCreateAt =
document.getElementById("chapterCreateAt");


init();

async function init(){

    mangas = await getMangas();

    renderMangas();

    bindEvents();

}

function bindEvents(){

    searchInput.oninput=()=>{

        renderMangas(

            searchInput.value

        );

    };

    newBtn.onclick=openNew;

    closeEditor.onclick=closePanel;

    saveBtn.onclick=saveCurrent;

    deleteBtn.onclick=removeCurrent;

    coverFileInput.onchange=e=>{

        coverFile=

        e.target.files[0];

        renderCover();

    };

    tagInput.addEventListener(

"keydown",

handleTagInput

);

}

function renderMangas(keyword=""){

    mangaGrid.innerHTML="";

    Object.entries(mangas)

    .filter(([slug,manga])=>{

        return manga.title

        .toLowerCase()

        .includes(

            keyword.toLowerCase()

        );

    })

    .sort((a,b)=>

        a[1].title.localeCompare(

            b[1].title

        )

    )

    .forEach(([slug,manga])=>{

        const card=

        document.createElement("div");

        card.className="manga-card";

        card.innerHTML=`

        <img src="${manga.cover}">

        <div class="card-body">

            <h3>

            ${manga.title}

            </h3>

            <p>

            ${manga.author}

            </p>

            <small>

            ${manga.chapters.length}

            Chapters

            </small>

        </div>

        `;

        card.onclick=()=>{

            openEditor(

                slug

            );

        };

        mangaGrid.appendChild(card);

    });

}

function renderCover(){

    if(!coverFile){

        coverPreview.innerHTML="";

        return;

    }

    const reader=new FileReader();

    reader.onload=e=>{

        coverPreview.innerHTML=

        `<img src="${e.target.result}">`;

    };

    reader.readAsDataURL(coverFile);

}

function openEditor(mangaSlug){

    currentSlug = mangaSlug;

    const manga = mangas[mangaSlug];

    if(!manga) return;

    editor.classList.remove("hidden");

    editorTitle.textContent = "Chỉnh sửa truyện";

    slug.value = mangaSlug;

    slug.disabled = true;

    title.value = manga.title || "";

    originalTitle.value = manga.original_title || "";

    author.value = manga.author || "";

    teamSelect.value = manga.team || "HeliumTG";

    status.value = manga.status || "Ongoing";

    description.value = manga.description || "";

    adminPick.checked = manga.adminPick || false;

    pickOrder.value = manga.pickOrder || 999;

    currentTags = [...(manga.tags || [])];

    renderTags();

    coverPreview.innerHTML =

    `<img src="${manga.cover}">`;

    coverFile = null;

    deleteBtn.style.display = "block";

    renderChapterList();

}

function openNew(){

    currentSlug = null;

    editor.classList.remove("hidden");

    editorTitle.textContent = "Thêm truyện";

    slug.disabled = false;

    slug.value = "";

    title.value = "";

    originalTitle.value = "";

    author.value = "";

    teamSelect.value = teams[0] || "HeliumTG";

    status.value = "Ongoing";

    description.value = "";

    currentTags = [];

    renderTags();

    adminPick.checked = false;

    pickOrder.value = 999;

    coverPreview.innerHTML = "";

    coverFile = null;

    coverFileInput.value = "";

    deleteBtn.style.display = "none";

}
function closePanel(){

    editor.classList.add("hidden");

}

async function saveCurrent(){

    const mangaSlug = slug.value.trim();

if(!mangaSlug){

    alert("Slug không được để trống.");

    return;

}

if(!title.value.trim()){

    alert("Chưa nhập tên truyện.");

    return;

}

    try{

        saveBtn.disabled=true;

        saveBtn.innerHTML="Đang lưu...";

        let cover="";

        if(currentSlug){

            cover=

            mangas[currentSlug].cover;

        }

        if(coverFile){

            const mangaSlug = slug.value.trim();

cover = await uploadImage(

coverFile,

mangaSlug,

"cover.webp"

);

        }

        const manga={

            slug:slug.value.trim(),

            title:title.value.trim(),

            original_title:

                originalTitle.value.trim(),

            author:author.value.trim(),

            team: teamSelect.value,

            status:status.value,

            tags:[...currentTags],

            description:

                description.value.trim(),

            cover:cover,

            adminPick:

        adminPick.checked,

    pickOrder:

        Number(pickOrder.value)

        };

        if(currentSlug){

            await editManga(manga);

        }

        else{

            await newManga(manga);

        }

        mangas = await getMangas();

        renderMangas(

            searchInput.value

        );

        closePanel();

        alert("Đã lưu thành công.");

    }

    catch(err){

        console.error(err);

        alert(err.message);

    }

    saveBtn.disabled=false;

    saveBtn.innerHTML="Lưu";

}

async function removeCurrent(){

    if(!currentSlug) return;

    const ok = confirm(

        `Xóa ${currentSlug} ?`

    );

    if(!ok) return;

    try{

        await deleteManga(

            currentSlug

        );

        mangas=

        await getMangas();

        renderMangas();

        closePanel();

        alert("Đã xóa.");

    }

    catch(err){

        console.error(err);

        alert(err.message);

    }

}
function slugify(text){

    return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g,"")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g,"-")
        .replace(/^-|-$/g,"");

}
title.oninput = () => {

    if(currentSlug) return;

    slug.value = slugify(title.value);

};

function renderTags(){

    tagList.innerHTML="";

    currentTags.forEach((tag,index)=>{

        const item=

        document.createElement("span");

        item.className="tag-item";

        item.innerHTML=`

            ${tag}

            <button
                data-index="${index}"
                class="tag-remove"
            >

            ×

            </button>

        `;

        tagList.appendChild(item);

    });

}

function handleTagInput(e){

    if(e.key==="Enter"){

        e.preventDefault();

        let value=

        tagInput.value.trim();

        if(value==="") return;

        value=

        value

        .toLowerCase()

        .replace(/\b\w/g,

            c=>c.toUpperCase()

        );

        if(

            !currentTags.includes(value)

        ){

            currentTags.push(value);

        }

        tagInput.value="";

        renderTags();

    }

    if(

        e.key==="Backspace"

        &&

        tagInput.value===""

    ){

        currentTags.pop();

        renderTags();

    }

}

document.addEventListener(

"click",

e=>{

    if(

        e.target.classList.contains(

            "tag-remove"

        )

    ){

        currentTags.splice(

            Number(

                e.target.dataset.index

            ),

            1

        );

        renderTags();

    }

});

chapterList.onclick=e=>{

    if(e.target.classList.contains("editChapter")){

        openChapterEditor(

            Number(

                e.target.dataset.id

            )

        );

    }

    if(e.target.classList.contains("deleteChapter")){

        deleteChapter(

            Number(

                e.target.dataset.id

            )

        );

    }

};

let editingChapter=null;

function openChapterEditor(id){

    const manga=mangas[currentSlug];

    editingChapter=

    manga.chapters.find(

        c=>c.id===id

    );

    chapterModal.classList.remove("hidden");

    chapterModal.classList.add("show");

    chapterId.value=

        editingChapter.id;

    chapterName.value=

        editingChapter.title;

    chapterCreateAt.value=

        editingChapter.createAt

        .slice(0,10);

}

function closeChapterEditor(){

    chapterModal.classList.add("hidden");

    chapterModal.classList.remove("show");

}

saveChapterBtn.onclick=()=>{

    editingChapter.id=

        Number(

            chapterId.value

        );

    editingChapter.title=

        chapterName.value;

    editingChapter.createAt=

        new Date(

            chapterCreateAt.value

        ).toISOString();

    chapterModal.classList.add("hidden");

    renderChapterList();

};

function deleteChapter(id){

    if(!confirm("Xóa chapter?"))

        return;

    mangas[currentSlug].chapters=

    mangas[currentSlug].chapters.filter(

        c=>c.id!==id

    );

    renderChapterList();

}

addChapterBtn.onclick=()=>{

    editingChapter={

        id:

        mangas[currentSlug]

        .chapters.length+1,

        title:"",

        createAt:

        new Date()

        .toISOString(),

        folder:"",

        pages:0

    };

    mangas[currentSlug]

    .chapters.push(

        editingChapter

    );

    openChapterEditor(

        editingChapter.id

    );

};

function renderChapterList(){

    chapterList.innerHTML="";

    if(!currentSlug) return;

    const manga=mangas[currentSlug];

    manga.chapters

    .sort((a,b)=>a.id-b.id)

    .forEach(ch=>{

        chapterList.innerHTML+=`

        <div class="chapter-row">

            <div>

                <b>

                ${ch.title}

                </b>

                <small>

                ${ch.createAt}

                </small>

            </div>

            <div>

                <button

                class="editChapter"

                data-id="${ch.id}">

                ✏

                </button>

                <button

                class="deleteChapter"

                data-id="${ch.id}">

                🗑

                </button>

            </div>

        </div>

        `;

    });

}