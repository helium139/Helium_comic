import { paginateMangas, renderPagination } from "./pagination.mjs";
import { scopeMangas, assertCanManageManga, showStaffAccessError } from "../assets/js/staff-access.js";
import { getTeams, resolveMangaTeam, getTeamById } from "../assets/js/teams.js";
import { requireStaff } from "../assets/js/adminGuard.js";

import { getMangas } from "./api/manga.js";
import { uploadImage, stageMangaCover } from "./api/upload.js";

import {

    newManga,

    editManga,

    deleteManga,

    removeChapter

}

from "./api/github.js";

const currentStaff = await requireStaff();

let mangas = {};
let mangaPage = 1;

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

const teams = await getTeams();
teamSelect.replaceChildren();
for (const team of teams.filter(team => currentStaff.role === "admin" || team.id === currentStaff.teamId)) {
    const option = document.createElement("option");
    option.value = team.id;
    option.textContent = team.name;
    teamSelect.appendChild(option);
}

teamSelect.disabled = currentStaff.role === "team_leader";
const adminPick = document.getElementById("adminPick");
const rawCaughtUp = document.getElementById("isRawCaughtUp");
if (adminPick) adminPick.disabled = currentStaff.role !== "admin";


const chapterList =
document.getElementById("chapterList");

const addChapterBtn =
document.getElementById("addChapterBtn");


await init().catch(showStaffAccessError);

async function init(){

    mangas = scopeMangas(currentStaff, await getMangas());
    for (const manga of Object.values(mangas)) resolveMangaTeam(manga, teams);

    const requestedManga = new URLSearchParams(location.search).get("manga");
    if (requestedManga) assertCanManageManga(currentStaff, mangas[requestedManga]);
    renderMangas();
    bindEvents();
    if (requestedManga) openEditor(requestedManga);

}

function bindEvents(){

    searchInput.oninput=()=>{
        mangaPage = 1;

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

function renderMangas(keyword=searchInput.value){

    mangaGrid.replaceChildren();

    const filteredMangas = Object.entries(scopeMangas(currentStaff, mangas))

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

    ;
    const pagination = paginateMangas(filteredMangas, mangaPage);
    mangaPage = pagination.page;
    document.getElementById("manga-pagination-summary").textContent = `Showing ${pagination.first}–${pagination.last} of ${pagination.total} manga`;
    renderPagination(document.getElementById("manga-pagination"), pagination, page => {
        mangaPage = page;
        renderMangas(searchInput.value);
    });
    pagination.items.forEach(([slug,manga])=>{

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

    const manga = mangas[mangaSlug];
    try { assertCanManageManga(currentStaff, manga); }
    catch (error) { showStaffAccessError(error); return; }
    currentSlug = mangaSlug;

    editor.classList.remove("hidden");

    editorTitle.textContent = "Chỉnh sửa truyện";

    slug.value = mangaSlug;

    slug.disabled = true;

    title.value = manga.title || "";

    originalTitle.value = manga.original_title || "";

    author.value = manga.author || "";

    teamSelect.value = resolveMangaTeam(manga, teams).id;

    status.value = manga.status || "Ongoing";

    description.value = manga.description || "";

    currentTags = [...(manga.tags || [])];

    renderTags();

    coverPreview.innerHTML =

    `<img src="${manga.cover}">`;

    coverFile = null;
    coverFileInput.value = "";
    tagInput.value = "";

    deleteBtn.style.display = "block";

    renderChapterList();

    if (rawCaughtUp) rawCaughtUp.checked = manga.isRawCaughtUp === true;
    if (adminPick) {
        adminPick.checked = manga.adminPick === true;
        adminPick.disabled = currentStaff.role !== "admin";
    }

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

    teamSelect.value = currentStaff.role === "team_leader"
        ? currentStaff.teamId
        : teams.find(team => team.active)?.id || "";

    status.value = "Ongoing";

    description.value = "";

    currentTags = [];

    renderTags();

    if (adminPick) adminPick.checked = false;

    if (rawCaughtUp) rawCaughtUp.checked = false;

    coverPreview.innerHTML = "";

    coverFile = null;

    coverFileInput.value = "";

    deleteBtn.style.display = "none";
    tagInput.value = "";
    renderChapterList();

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

        if (currentSlug) assertCanManageManga(currentStaff, mangas[currentSlug]);
        const selectedTeam = await getTeamById(
            currentStaff.role === "team_leader" ? currentStaff.teamId : teamSelect.value, teams
        );
        if (!selectedTeam.active && (!currentSlug ||
            resolveMangaTeam(mangas[currentSlug], teams).id !== selectedTeam.id)) {
            throw new Error("Cannot assign manga to an inactive team");
        }
        let cover="";
        let coverStagingRef;

        if(currentSlug){

            cover=

            mangas[currentSlug].cover;

        }

        if(coverFile){

            const mangaSlug = slug.value.trim();

            if (currentSlug) {
                cover = (await uploadImage(coverFile, mangaSlug, "cover.webp")).url;
            } else {
                coverStagingRef = await stageMangaCover(coverFile);
            }

        }

        const manga={

            slug:slug.value.trim(),

            title:title.value.trim(),

            original_title:

                originalTitle.value.trim(),

            author:author.value.trim(),

            teamId: selectedTeam.id,

            team: selectedTeam.name,

            status:status.value,

            tags:[...currentTags],

            description:

                description.value.replace(/\r\n?/g, "\n").trim(),

            cover:cover,

            ...(coverStagingRef ? { coverStagingRef } : {}),

            chapters: currentSlug
        ? mangas[currentSlug].chapters
        : [],

            adminPick: currentStaff.role === "admin" && adminPick ? adminPick.checked === true
                : currentSlug ? mangas[currentSlug].adminPick === true : false,

            isRawCaughtUp: rawCaughtUp ? rawCaughtUp.checked === true
                : currentSlug ? mangas[currentSlug].isRawCaughtUp === true : false

        };

        if(currentSlug){

            await editManga(manga);

        }

        else{

            await newManga(manga);

        }

        mangas = scopeMangas(currentStaff, await getMangas());
        for (const manga of Object.values(mangas)) resolveMangaTeam(manga, teams);

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

        assertCanManageManga(currentStaff, mangas[currentSlug]);
        await deleteManga(

            currentSlug

        );

        mangas = scopeMangas(currentStaff, await getMangas());

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
`/admin/chapter/?manga=${currentSlug}&chapter=${id}`;

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

    try{

        assertCanManageManga(currentStaff, manga);
        await removeChapter(currentSlug, id);
        manga.chapters = manga.chapters.filter(c => Number(c.id) !== id);

        renderChapterList();

        alert("Đã xóa chapter.");

    }

    catch(err){

        alert("Xóa chapter thất bại.");

        console.error(err);

    }

}

function renderChapterList(){

    chapterList.innerHTML = "";

    if(!currentSlug) return;

    const manga = mangas[currentSlug];

    [...(manga.chapters || [])]
        .sort((a,b)=>a.id-b.id)
        .forEach(ch=>{

            chapterList.innerHTML += `
            <div class="chapter-row">

                <div class="chapter-info">

                    <b>${ch.title}</b>

                    <span>

                        ${new Date(ch.createAt).toLocaleDateString("vi-VN")}
                    </span>

                </div>

                <div class="chapter-actions">

                    <button
                        class="editChapter primary"
                        data-id="${ch.id}">

                        <i class='bx bx-edit'></i>

                        Chỉnh sửa

                    </button>

                    <button
                        class="deleteChapter danger"
                        data-id="${ch.id}">

                        <i class='bx bx-trash'></i>

                    </button>

                </div>

            </div>
            `;

        });

}

addChapterBtn.onclick = ()=>{
    try { assertCanManageManga(currentStaff, mangas[currentSlug]); }
    catch (error) { showStaffAccessError(error); return; }
    location.href =
`/admin/chapter/?manga=${currentSlug}&new=1`;

};
