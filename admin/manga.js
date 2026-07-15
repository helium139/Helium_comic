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

const team =
document.getElementById("team");

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

        return;

    }

    const reader=

    new FileReader();

    reader.onload=e=>{

        coverPreview.innerHTML=`

        <img

        src="${e.target.result}">

        `;

    };

    reader.readAsDataURL(

        coverFile

    );

}

function openEditor(mangaSlug){

    currentSlug = mangaSlug;

    const manga = mangas[mangaSlug];

    editor.classList.remove("hidden");

    editorTitle.innerHTML = "Chỉnh sửa truyện";

    slug.value = mangaSlug;

    slug.disabled = true;

    title.value = manga.title || "";

    originalTitle.value = manga.original_title || "";

    author.value = manga.author || "";

    team.value = manga.team || "";

    status.value = manga.status || "Ongoing";

    tags.value =

        (manga.tags || []).join(",");

    description.value =

        manga.description || "";

    coverPreview.innerHTML =

    `<img src="${manga.cover}">`;

    coverFile = null;

    adminPick.checked =

manga.adminPick || false;

pickOrder.value =

manga.pickOrder || 999;

    deleteBtn.style.display="block";

}

function openNew(){

    currentSlug = null;

    editor.classList.remove("hidden");

    editorTitle.innerHTML="Thêm truyện";

    slug.disabled=false;

    slug.value="";

    title.value="";

    originalTitle.value="";

    author.value="";

    team.value="";

    status.value="Ongoing";

    tags.value="";

    description.value="";

    coverPreview.innerHTML="";

    coverFile=null;

    coverFileInput.value="";

    deleteBtn.style.display="none";

}

function closePanel(){

    editor.classList.add("hidden");

}

async function saveCurrent(){

    try{

        saveBtn.disabled=true;

        saveBtn.innerHTML="Đang lưu...";

        let cover="";

        if(currentSlug){

            cover=

            mangas[currentSlug].cover;

        }

        if(coverFile){

            cover = await uploadImage(

    coverFile,

    slug.value,

    "cover.webp"

);

        }

        const manga={

            slug:slug.value.trim(),

            title:title.value.trim(),

            original_title:

                originalTitle.value.trim(),

            author:author.value.trim(),

            team:team.value.trim(),

            status:status.value,

            tags:

                tags.value

                .split(",")

                .map(t=>t.trim())

                .filter(Boolean),

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
title.oninput = ()=>{

    slug.value = slugify(title.value);

}