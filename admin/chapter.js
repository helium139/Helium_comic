import { requireAdmin } from "../assets/js/adminGuard.js";

import { getMangas } from "./api/manga.js";

import { uploadImage } from "./api/upload.js";

import {

    publishChapter,

    updateChapter

} from "./api/github.js";

requireAdmin();

/* ===========================
        STATE
=========================== */

let mangas = {};

let selectedFiles = [];

let existingImages = [];

let mode = "new";

let currentManga = "";

let currentChapter = null;


/* ===========================
            DOM
=========================== */

const mangaSelect =
document.getElementById("mangaSelect");

const chapterNumber =
document.getElementById("chapterNumber");

const chapterTitle =
document.getElementById("chapterTitle");

const chapterDate =
document.getElementById("chapterDate");

const chapterFiles =
document.getElementById("chapterFiles");

const uploadBtn =
document.getElementById("uploadBtn");

const preview =
document.getElementById("preview");

const dropZone =
document.getElementById("dropZone");

const progress =
document.getElementById("progress");

const uploadLog =
document.getElementById("uploadLog");

const fileCount =
document.getElementById("fileCount");

const fileSize =
document.getElementById("fileSize");

const pageTitle =
document.getElementById("pageTitle");

const createMode =
document.getElementById("createMode");

const editMode =
document.getElementById("editMode");

const mangaName =
document.getElementById("mangaName");

const mangaSlug =
document.getElementById("mangaSlug");

const addImageBtn =
document.getElementById("addImageBtn");

const imageCount =
document.getElementById("imageCount");

const totalSize =
document.getElementById("totalSize");

const backBtn =
document.getElementById("backBtn");

init();

async function init(){

    mangas = await getMangas();

    parseQuery();

    renderMangaList();

    bindEvents();

    if(mode==="edit"){

        loadChapter();

    }

    else{

        setToday();

        updateNextChapter();

    }

}

function parseQuery(){

    const params = new URLSearchParams(

        location.search

    );

    const slug = params.get("manga");

    const chapter = Number(

        params.get("chapter")

    );

    if(slug && chapter){

        mode = "edit";

        currentManga = slug;

        currentChapter = chapter;

    }

}

function bindEvents(){

    mangaSelect.onchange = ()=>{

        if(mode==="new"){

            updateNextChapter();

        }

    };

    chapterFiles.onchange = e=>{

        selectedFiles.push(

            ...Array.from(

                e.target.files

            )

        );

        renderPreview();

        chapterFiles.value="";

    };

    addImageBtn.onclick=()=>{

        chapterFiles.click();

    };

    uploadBtn.onclick=save;

    backBtn.onclick=()=>{

        history.back();

    };

    initDragDrop();

}

async function save(){

    uploadBtn.disabled=true;

    try{

        if(mode==="new"){

            await uploadChapter();

        }

        else{

            await saveChapter();

        }

        alert("Đã lưu.");

    }

    catch(err){

        alert(err.message);

    }

    uploadBtn.disabled=false;

}

function renderMangaList(){

    mangaSelect.innerHTML="";

    Object.entries(mangas)

    .sort((a,b)=>

        a[1].title.localeCompare(

            b[1].title

        )

    )

    .forEach(([slug,manga])=>{

        mangaSelect.innerHTML+=`

        <option value="${slug}">

            ${manga.title}

        </option>

        `;

    });

}

async function loadChapter(){

    createMode.classList.add("hidden");

    editMode.classList.remove("hidden");

    pageTitle.textContent = "Chapter Editor";

    uploadBtn.innerHTML =
    "<i class='bx bx-save'></i> Lưu thay đổi";

    mangaSelect.value = currentManga;

    mangaSelect.disabled = true;

    const manga = mangas[currentManga];

    if(!manga){

        alert("Không tìm thấy truyện.");

        return;

    }

    mangaName.value = manga.title;

    mangaSlug.value = currentManga;

    const chapter = manga.chapters.find(

        c => c.id === currentChapter

    );

    if(!chapter){

        alert("Không tìm thấy chapter.");

        return;

    }

    currentChapter = chapter;

    chapterNumber.value = chapter.id;

    chapterTitle.value = chapter.title;

    chapterDate.value =

        chapter.createAt.substring(0,10);

    existingImages = [];

    for(let i=1;i<=chapter.pages;i++){

        existingImages.push({

            type:"remote",

            name:`${i}.webp`,

            url:`${chapter.folder}/${i}.webp`

        });

    }

    renderPreview();

}

function updateNextChapter(){

    const manga = mangas[mangaSelect.value];

    if(!manga) return;

    const next = manga.chapters.length + 1;

    chapterNumber.value = next;

    chapterTitle.value = `Chap ${next}`;

}

function setToday(){

    chapterDate.value =

        new Date()

        .toISOString()

        .split("T")[0];

}

function initDragDrop(){

    dropZone.addEventListener("dragover",e=>{

        e.preventDefault();

        dropZone.classList.add("dragging");

    });

    dropZone.addEventListener("dragleave",()=>{

        dropZone.classList.remove("dragging");

    });

    dropZone.addEventListener("drop",e=>{

        e.preventDefault();

        dropZone.classList.remove("dragging");

        selectedFiles.push(

            ...Array.from(

                e.dataTransfer.files

            )

        );

        renderPreview();

    });

}

function updateStats(){

    const total =

        selectedFiles.reduce(

            (sum,file)=>

            sum+file.size,

            0

        );

    const count =

        existingImages.length+

        selectedFiles.length;

    fileCount.textContent = count;

    imageCount.textContent = count;

    fileSize.textContent =

        (total/1024/1024)

        .toFixed(2)

        +" MB";

    totalSize.textContent =

        fileSize.textContent;

}

function renderPreview(){

    preview.innerHTML = "";

    const images = [

        ...existingImages,

        ...selectedFiles

    ];

    if(images.length===0){

        preview.innerHTML =

        `<div class="empty-preview">

            Chưa có ảnh

        </div>`;

        updateStats();

        return;

    }

    images.forEach((img,index)=>{

        const card = document.createElement("div");

        card.className = "thumb";

        card.dataset.index = index;

        const image = document.createElement("img");

        if(img.type==="remote"){

            image.src = img.url;

        }

        else{

            image.src = URL.createObjectURL(img);

        }

        const number = document.createElement("div");

        number.className = "thumb-index";

        number.textContent = index+1;

        const name = document.createElement("div");

        name.className = "thumb-name";

        name.textContent = img.name;

        const remove = document.createElement("button");

        preview.addEventListener("click",e=>{

    const btn =

        e.target.closest(

            ".remove-thumb"

        );

    if(!btn) return;

    const index =

        Number(

            btn.dataset.index

        );

    if(index<existingImages.length){

        existingImages.splice(

            index,

            1

        );

    }

    else{

        selectedFiles.splice(

            index-existingImages.length,

            1

        );

    }

    renderPreview();

});

        remove.dataset.index = index;

        remove.innerHTML = "✕";

        card.append(

            image,

            number,

            name,

            remove

        );

        preview.appendChild(card);

    });

    updateStats();

    initSortable();

}

let sortable = null;

function initSortable(){

    if(sortable){

        sortable.destroy();

    }

    sortable = Sortable.create(

        preview,

        {

            animation:180,

            ghostClass:"dragging",

            onEnd(e){

                const all = [

                    ...existingImages,

                    ...selectedFiles

                ];

                const moved =

                    all.splice(

                        e.oldIndex,

                        1

                    )[0];

                all.splice(

                    e.newIndex,

                    0,

                    moved

                );

                existingImages =

                    all.filter(

                        x=>x.type==="remote"

                    );

                selectedFiles =

                    all.filter(

                        x=>x.type!=="remote"

                    );

                renderPreview();

            }

        }

    );

}

async function saveChapter(){

    const slug = currentManga;

    const chapterId = currentChapter.id;

    const folder = `${slug}/chap${chapterId}`;

    log("Đang upload ảnh...");

    let page = existingImages.length;

    for(const file of selectedFiles){

        page++;

        const ext =

            file.name

            .split(".")

            .pop()

            .toLowerCase();

        await uploadImage(

            file,

            folder,

            `${page}.${ext}`

        );

        log(`✔ ${page}.${ext}`);

    }

    log("Đang cập nhật data.json...");

    await updateChapter({

        manga: slug,

        chapterId,

        title: chapterTitle.value.trim(),

        createAt: chapterDate.value,

        pages:

            existingImages.length+

            selectedFiles.length

    });

    progress.innerHTML =

        "✔ Đã lưu thành công";

    log("✔ Done");

}

async function uploadChapter(){

    const slug = mangaSelect.value;

    const chapter = Number(

        chapterNumber.value

    );

    const title =

        chapterTitle.value.trim();

    if(title===""){

        throw new Error(

            "Chưa nhập tiêu đề."

        );

    }

    for(let i=0;i<selectedFiles.length;i++){

        const file = selectedFiles[i];

        const ext =

            file.name

            .split(".")

            .pop()

            .toLowerCase();

        await uploadImage(

            file,

            `${slug}/chap${chapter}`,

            `${i+1}.${ext}`

        );

        log(`✔ ${i+1}.${ext}`);

    }

    await publishChapter({

        manga:slug,

        chapterNumber:chapter,

        title,

        imageCount:selectedFiles.length

    });

    progress.innerHTML="✔ Upload xong";

}

function resetForm(){

    selectedFiles=[];

    existingImages=[];

    preview.innerHTML="";

    uploadLog.innerHTML="";

    progress.innerHTML="";

    chapterFiles.value="";

    updateStats();

}

function log(text){

    const div=

    document.createElement("div");

    div.textContent=text;

    uploadLog.appendChild(div);

    uploadLog.scrollTop=

    uploadLog.scrollHeight;

}