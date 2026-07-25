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

const addChapterBtn =
document.getElementById("addChapterBtn");


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

            chapters: currentSlug
        ? mangas[currentSlug].chapters
        : [],

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

        let value = tagInput.value.trim();

        if(value==="") return;

        value = titleCase(value);

        if(!currentTags.includes(value)){

            currentTags.push(value);

        }

        tagInput.value = "";

        renderTags();

    }

    if(

        e.key==="Backspace" &&

        tagInput.value===""

    ){

        currentTags.pop();

        renderTags();

    }

}

function titleCase(text){

    return text
        .trim()
        .toLocaleLowerCase("vi-VN")
        .split(/\s+/)
        .map(word=>

            word.substring(0,1)
                .toLocaleUpperCase("vi-VN") +

            word.substring(1)

        )
        .join(" ");

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

chapterList.onclick = e=>{

    const edit = e.target.closest(".editChapter");

    const del = e.target.closest(".deleteChapter");

    if(edit){

        const id = Number(edit.dataset.id);

        location.href =
`chapter.html?manga=${currentSlug}&chapter=${id}`;

    }

    if(del){

        deleteChapter(

            Number(del.dataset.id)

        );

    }

};



async function deleteChapter(id){

    if(!confirm("Xóa chapter?")) return;

    const manga = mangas[currentSlug];

    manga.chapters = manga.chapters.filter(
        c => c.id !== id
    );

    try{

        await editManga({

            slug: currentSlug,

            ...manga

        });

        renderChapterList();

        alert("Đã xóa chapter.");

    }

    catch(err){

        alert("Xóa chapter thất bại.");

        console.error(err);

    }

}