import { requireAdmin } from "../assets/js/adminGuard.js";

import { getMangas } from "./api/manga.js";
import { uploadImage } from "./api/upload.js";
import { publishChapter } from "./api/github.js";

requireAdmin();

let mangas = {};
let selectedFiles = [];

let editMode = false;
let currentChapter = null;
/* ===========================
            DOM
=========================== */

const mangaSelect = document.getElementById("mangaSelect");
const chapterNumber = document.getElementById("chapterNumber");
const chapterTitle = document.getElementById("chapterTitle");
const chapterDate = document.getElementById("chapterDate");

const chapterFiles = document.getElementById("chapterFiles");

const uploadBtn = document.getElementById("uploadBtn");

const progress = document.getElementById("progress");

const dropZone = document.getElementById("dropZone");

/* preview */

const preview = document.getElementById(

"preview"

);
const fileCount =
document.getElementById("fileCount");

const fileSize =
document.getElementById("fileSize");
const uploadLog =
document.getElementById("uploadLog");
const folderPicker=
document.getElementById("folderPicker");

/* ===========================
        INIT
=========================== */

init();

async function init(){

    mangas = await getMangas();

    renderMangaList();

    bindEvents();

    await loadFromQuery();

}

/* ===========================
        EVENTS
=========================== */

function bindEvents(){

    mangaSelect.onchange = updateNextChapter;

    chapterFiles.onchange = e=>{

        selectedFiles = Array.from(e.target.files);

        sortFiles();

        renderPreview();

    };

    uploadBtn.onclick=async()=>{

    uploadBtn.disabled=true;

    uploadBtn.innerHTML="Đang lưu...";

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

    uploadBtn.innerHTML="Lưu thay đổi";

};

    initDragDrop();

}

/* ===========================
      MANGA LIST
=========================== */

function renderMangaList(){

    mangaSelect.innerHTML="";

    Object.entries(mangas)

    .sort((a,b)=>

        a[1].title.localeCompare(b[1].title)

    )

    .forEach(([slug,manga])=>{

        mangaSelect.innerHTML+=`

        <option value="${slug}">
            ${manga.title}
        </option>

        `;

    });

    updateNextChapter();

}

function updateNextChapter(){

    const slug=mangaSelect.value;

    const manga=mangas[slug];

    if(!manga) return;

    const next=manga.chapters.length+1;

    chapterNumber.value=next;

    chapterTitle.value=`Chap ${next}`;

}

function setToday(){

    chapterDate.value=

    new Date()

    .toISOString()

    .split("T")[0];

}

/* ===========================
        DRAG & DROP
=========================== */

function initDragDrop(){

    if(!dropZone) return;

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

        selectedFiles = Array.from(e.dataTransfer.files);

        sortFiles();

        renderPreview();

    });

}

/* ===========================
        FILE SORT
=========================== */

function sortFiles(){

    selectedFiles.sort((a,b)=>{

        return a.name.localeCompare(

            b.name,

            undefined,

            {

                numeric:true,

                sensitivity:"base"

            }

        );

    });

}

/* ===========================
        PREVIEW
=========================== */

function renderPreview(){

    preview.innerHTML = "";

    updateFileInfo();

    if(selectedFiles.length===0){

        preview.innerHTML=`
        <div class="empty-preview">
            Chưa chọn ảnh
        </div>
        `;

        return;
    }

    selectedFiles.forEach((file,index)=>{

        const card=document.createElement("div");

        card.className="thumb";

        card.dataset.index=index;

        const img=document.createElement("img");

        card.appendChild(img);

        if(file.existing){

    img.src=file.url;

}else{

    const reader=new FileReader();

    reader.onload=e=>{

        img.src=e.target.result;

    };

    reader.readAsDataURL(file);

}

        reader.readAsDataURL(file);

        card.innerHTML+=`

        <div class="thumb-index">

            ${index+1}

        </div>

        <div class="thumb-name">

            ${file.name}

        </div>

        <button
            class="remove-thumb"
            data-index="${index}">

            ✕

        </button>

        `;

        preview.appendChild(card);

    });

}

/* ===========================
        REMOVE IMAGE
=========================== */

preview.addEventListener("click",e=>{

    const btn=e.target.closest(".remove-thumb");

    if(!btn) return;

    const index=Number(btn.dataset.index);

    selectedFiles.splice(index,1);

    renderPreview();

});

/* ===========================
        PROGRESS
=========================== */

function setProgress(text){

    progress.innerHTML = text;

    log(text);

}
function updateFileInfo(){

    const total=

        selectedFiles.reduce(

            (sum,file)=>sum+file.size,

            0

        );

    fileCount.textContent=

        selectedFiles.length;

    fileSize.textContent=

        (total/1024/1024).toFixed(2)

        +" MB";

}

function setUploadPercent(current,total){

    const percent=

    Math.floor(

        current/total*100

    );

    progress.innerHTML=`

    <div class="progress-bar">

        <div

        class="progress-fill"

        style="width:${percent}%">

        </div>

    </div>

    <p>

    ${current}/${total}

    (${percent}%)

    </p>

    `;

}

/* ===========================
        UPLOAD CHAPTER
=========================== */

async function uploadChapter(){

    const slug = mangaSelect.value;

    const chapter = Number(chapterNumber.value);

    const title = chapterTitle.value.trim();

    if(title===""){

        throw new Error("Chưa nhập tên chapter.");

    }

    setProgress("Bắt đầu upload...");

    for(let i=0;i<selectedFiles.length;i++){

        const file = selectedFiles[i];

    if(file.existing){

        continue;

    }

        const extension = file.name.split(".").pop().toLowerCase();

const filename = `${i+1}.${extension}`;
        setUploadPercent(

            i,

            selectedFiles.length

        );
       

        await uploadImage(

    file,

    `${slug}/chap${chapter}`,

    filename

);
        log(

`✔ ${filename}`

);
    }

    setUploadPercent(

        selectedFiles.length,

        selectedFiles.length

    );

    setProgress("Đang cập nhật data.json...");

    const result =

        await publishChapter({

            manga:slug,

            chapterNumber:chapter,

            title:title,

            imageCount:selectedFiles.length

        });

    if(!result.success){

        throw new Error(

            result.message ||

            "Github Commit thất bại."

        );

    }
    else log("✔ Github Commit");

    setProgress("✔ Upload thành công");
    log("✔ Github Pages Deploy");

}

/* ===========================
        RESET
=========================== */

function resetForm(){

    selectedFiles=[];

    chapterFiles.value="";

    progress.innerHTML="";

    uploadLog.innerHTML="";

    updateNextChapter();

    updateFileInfo();

    renderPreview();

}

function log(text){

const div=

document.createElement(

"div"

);

div.innerHTML=text;

uploadLog.appendChild(div);

uploadLog.scrollTop=

uploadLog.scrollHeight;

}

folderPicker.onchange=e=>{

selectedFiles=

Array.from(

e.target.files

);

sortFiles();

renderPreview();

};

const pageTitle = document.getElementById("pageTitle");

const createMode = document.getElementById("createMode");

const mangaName = document.getElementById("mangaName");

const mangaSlug = document.getElementById("mangaSlug");

const addImageBtn =
document.getElementById("addImageBtn");

const preview =
document.getElementById("preview");0

const imageCount =
document.getElementById("imageCount");

const totalSize =
document.getElementById("totalSize");

const backBtn =
document.getElementById("backBtn");

init();

async function init(){

    mangas = await getMangas();

    parseUrl();

    renderMangaList();

    bindEvents();

    if(mode==="edit"){

        loadEditor();

    }else{

        setToday();

        updateNextChapter();

    }

}

function parseUrl(){

    const params = new URLSearchParams(location.search);

    const slug = params.get("manga");

    const chapter = Number(params.get("chapter"));

    if(slug && chapter){

        mode="edit";

        currentManga=slug;

        currentChapter=chapter;

    }

}

function loadEditor(){

    createMode.classList.add("hidden");

    editMode.classList.remove("hidden");

    pageTitle.innerHTML="Chapter Editor";

    uploadBtn.innerHTML=

    "<i class='bx bx-save'></i> Lưu thay đổi";

    const manga = mangas[currentManga];

    if(!manga) return;

    mangaName.value=manga.title;

    mangaSlug.value=currentManga;

    const chapter=

    manga.chapters.find(

        c=>c.id===currentChapter

    );

    if(!chapter) return;

    chapterTitle.value=

    chapter.title;

    chapterDate.value=

    chapter.createAt.substring(0,10);

    existingImages=[];

    for(

        let i=1;

        i<=chapter.pages;

        i++

    ){

        existingImages.push({

            type:"remote",

            name:`${i}.webp`,

            url:

            `${chapter.folder}/${i}.webp`

        });

    }

    renderPreview();

}

function bindEvents(){

    mangaSelect.onchange=updateNextChapter;

    addImageBtn.onclick=()=>{

        chapterFiles.click();

    };

    chapterFiles.onchange=e=>{

        selectedFiles.push(

    ...Array.from(

        e.target.files

    )

);

renderPreview();

chapterFiles.value="";

    };

    backBtn.onclick=()=>{

        history.back();

    };

    initDragDrop();

}

function renderPreview(){

    preview.innerHTML="";

    const images=[

        ...existingImages,

        ...selectedFiles

    ];

    if(images.length===0){

        preview.innerHTML=

        "<div class='empty-preview'>Chưa có ảnh</div>";

        updateStats();

        return;

    }

    images.forEach((img,index)=>{

        const card=document.createElement("div");

        card.className="thumb";

        let src="";

        if(img.type==="remote"){

            src=img.url;

        }

        else{

            src=URL.createObjectURL(img);

        }

        card.innerHTML=`

        <img src="${src}">

        <div class="thumb-index">

            ${index+1}

        </div>

        <div class="thumb-name">

            ${img.name}

        </div>

        <button

        class="remove-thumb"

        data-index="${index}">

        ✕

        </button>

        `;

        preview.appendChild(card);

    });

    updateStats();

}

new Sortable(preview,{

    animation:150,

    onEnd(e){

        const item = selectedFiles.splice(e.oldIndex,1)[0];

        selectedFiles.splice(e.newIndex,0,item);

        renderPreview();

    }

});

function updateStats(){

    const total=

    selectedFiles.reduce(

        (sum,f)=>sum+f.size,

        0

    );

    imageCount.innerHTML=

    existingImages.length+

    selectedFiles.length;

    totalSize.innerHTML=

    (total/1024/1024)

    .toFixed(2)+" MB";

}

function initSortable(){

    Sortable.create(preview,{

        animation:150,

        ghostClass:"dragging",

        onEnd(){

            const cards=[

                ...preview.children

            ];

            const merged=[

                ...existingImages,

                ...selectedFiles

            ];

            const reordered=[];

            cards.forEach(card=>{

                reordered.push(

                    merged[
                        Number(

                            card.dataset.index

                        )
                    ]

                );

            });

            existingImages=
                reordered.filter(
                    i=>i.type==="remote"
                );

            selectedFiles=
                reordered.filter(
                    i=>!i.type
                );

            renderPreview();

        }

    });

}

preview.onclick=e=>{

    const btn=

    e.target.closest(".remove-thumb");

    if(!btn) return;

    const index=

    Number(

        btn.dataset.index

    );

    const totalRemote=

    existingImages.length;

    if(index<totalRemote){

        existingImages.splice(index,1);

    }

    else{

        selectedFiles.splice(

            index-totalRemote,

            1

        );

    }

    renderPreview();

};

async function saveChapter(){

    log("Đang upload...");

    let page=

    existingImages.length;

    for(

        const file of selectedFiles

    ){

        page++;

        const ext=

        file.name

        .split(".")

        .pop();

        await uploadImage(

            file,

            `${currentManga}/chap${currentChapter}`,

            `${page}.${ext}`

        );

    }

    log("Đang commit...");

    await updateChapter({

    manga:slug,

    chapterId:chapter,

    title:chapterTitle.value,

    pages:selectedFiles.length

});

    log("✔ Done");

}

async function loadFromQuery(){

    const params = new URLSearchParams(location.search);

    const slug = params.get("manga");
    const chapter = Number(params.get("chapter"));

    if(!slug || !chapter){

        setToday();

        return;

    }

    editMode = true;

    mangaSelect.value = slug;

    mangaSelect.disabled = true;

    const manga = mangas[slug];

    currentChapter = manga.chapters.find(c=>c.id===chapter);

    if(!currentChapter) return;

    chapterNumber.value = currentChapter.id;
    chapterTitle.value = currentChapter.title;
    chapterDate.value = currentChapter.createAt.slice(0,10);

    uploadBtn.innerHTML =
    "<i class='bx bx-save'></i> Save Chapter";

    await loadChapterImages();

}

async function loadChapterImages(){

    selectedFiles=[];

    for(let i=1;i<=currentChapter.pages;i++){

        selectedFiles.push({

            name:`${i}.webp`,

            url:`${currentChapter.folder}/${i}.webp`,

            existing:true

        });

    }

    renderPreview();

}