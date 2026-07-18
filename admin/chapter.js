import { requireAdmin } from "../assets/js/adminGuard.js";
import { getMangas } from "./api/manga.js";
import { uploadImage } from "./api/upload.js";
import {
    publishChapter,
    updateChapter,
    renameImages
} from "./api/github.js";

requireAdmin();

/* ===========================
        STATE
=========================== */

let mangas = {};

let mode = "new";

let currentSlug = "";

let currentChapter = 0;

let existingImages = [];

let newImages = [];

let sortable = null;

/* ===========================
        DOM
=========================== */

const mangaSelect = document.getElementById("mangaSelect");
const chapterNumber = document.getElementById("chapterNumber");
const chapterTitle = document.getElementById("chapterTitle");
const chapterDate = document.getElementById("chapterDate");

const chapterFiles = document.getElementById("chapterFiles");
const folderPicker = document.getElementById("folderPicker");

const uploadBtn = document.getElementById("uploadBtn");

const preview = document.getElementById("preview");

const dropZone = document.getElementById("dropZone");

const uploadLog = document.getElementById("uploadLog");

const progress = document.getElementById("progress");

const fileCount = document.getElementById("fileCount");

const fileSize = document.getElementById("fileSize");

const addImageBtn = document.getElementById("addImageBtn");
/* ===========================
        INIT
=========================== */

init();

async function init(){

    mangas = await getMangas();

    parseQuery();

    renderMangaList();

    bindEvents();

    if(mode==="edit"){

        await loadEditor();

    }

    else{

        setToday();

        updateNextChapter();

    }

}

/* ===========================
        QUERY
=========================== */

function parseQuery(){

    const params = new URLSearchParams(location.search);

    const slug = params.get("manga");

    const chapter = Number(params.get("chapter"));

    if(slug && chapter){

        mode = "edit";

        currentSlug = slug;

        currentChapter = chapter;

    }

}

/* ===========================
        EVENTS
=========================== */

function bindEvents(){

    mangaSelect.onchange = ()=>{

        if(mode==="new"){

            updateNextChapter();

        }

    };

    chapterFiles.onchange = e=>{

        newImages.push(

            ...Array.from(e.target.files)

        );

        renderPreview();

        chapterFiles.value = "";

    };

    if(folderPicker){

        folderPicker.onchange = e=>{

            newImages.push(

                ...Array.from(e.target.files)

            );

            renderPreview();

            folderPicker.value = "";

        };

    }

    uploadBtn.onclick = save;

    initDragDrop();

}

/* ===========================
        MANGA
=========================== */

function renderMangaList(){

    mangaSelect.innerHTML = "";

    Object.entries(mangas)

    .sort((a,b)=>

        a[1].title.localeCompare(

            b[1].title

        )

    )

    .forEach(([slug,manga])=>{

        mangaSelect.innerHTML +=

        `<option value="${slug}">

            ${manga.title}

        </option>`;

    });

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

/* ===========================
        EDITOR
=========================== */

async function loadEditor(){

    mangaSelect.value = currentSlug;

    mangaSelect.disabled = true;

    const manga = mangas[currentSlug];

    if(!manga){

        alert("Không tìm thấy truyện.");

        return;

    }

    const chapter = manga.chapters.find(

        c=>c.id===currentChapter

    );

    if(!chapter){

        alert("Không tìm thấy chapter.");

        return;

    }

    chapterNumber.value = chapter.id;

    chapterTitle.value = chapter.title;

    chapterDate.value =

        chapter.createAt.substring(0,10);

    uploadBtn.innerHTML =

    "<i class='bx bx-save'></i> Lưu thay đổi";

    existingImages = [];

    for(let i=1;i<=chapter.pages;i++){

        existingImages.push({

            type:"remote",

            name:`${i}.jpg`,

            url:`${chapter.folder}/${i}.jpg`

        });

    }

    renderPreview();

}

/* ===========================
        DRAG DROP
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

        newImages.push(

            ...Array.from(

                e.dataTransfer.files

            )

        );

        renderPreview();

    });

}

/* ===========================
        PREVIEW
=========================== */

function renderPreview(){

    preview.innerHTML = "";

    const images = [

        ...existingImages,

        ...newImages

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

        remove.className = "remove-thumb";

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

/* ===========================
        SORTABLE
=========================== */

function initSortable(){

    if(sortable){

        sortable.destroy();

    }

    sortable = Sortable.create(preview,{

        animation:180,

        ghostClass:"dragging",

        onEnd(e){

    const all=[

        ...existingImages,

        ...newImages

    ];

    const moved=all.splice(

        e.oldIndex,

        1

    )[0];

    all.splice(

        e.newIndex,

        0,

        moved

    );

    existingImages=[];

    newImages=[];

    all.forEach(img=>{

        if(img.type==="remote"){

            existingImages.push(img);

        }

        else{

            newImages.push(img);

        }

    });

    renderPreview();

}

    });

}

/* ===========================
        REMOVE IMAGE
=========================== */

preview.addEventListener("click",e=>{

    const btn = e.target.closest(

        ".remove-thumb"

    );

    if(!btn) return;

    const index = Number(

        btn.dataset.index

    );

    if(index < existingImages.length){

        existingImages.splice(

            index,

            1

        );

    }

    else{

        newImages.splice(

            index-existingImages.length,

            1

        );

    }

    renderPreview();

});

/* ===========================
        STATS
=========================== */

function updateStats(){

    const total = newImages.reduce(

        (sum,file)=>sum+file.size,

        0

    );

    const count =

        existingImages.length+

        newImages.length;

    fileCount.textContent = count;

    fileSize.textContent =

        (total/1024/1024)

        .toFixed(2)

        +" MB";

}

/* ===========================
        SAVE
=========================== */

async function save(){

    uploadBtn.disabled = true;

    uploadBtn.innerHTML =

    "Đang lưu...";

    try{

        if(mode==="new"){

            await uploadChapter();

        }

        else{

            await saveChapter();

        }

        alert("Đã lưu thành công.");

    }

    catch(err){

        console.error(err);

        alert(err.message);

    }

    uploadBtn.disabled = false;

    uploadBtn.innerHTML =

    mode==="edit"

    ? "<i class='bx bx-save'></i> Lưu thay đổi"

    : "<i class='bx bx-upload'></i> Upload Chapter";

}

/* ===========================
        NEW CHAPTER
=========================== */

async function uploadChapter(){

    const slug = mangaSelect.value;

    const chapter = Number(

        chapterNumber.value

    );

    const title =

        chapterTitle.value.trim();

    if(!title){

        throw new Error(

            "Chưa nhập tiêu đề."

        );

    }

    progress.innerHTML =

    "Đang upload...";

    for(let i=0;i<newImages.length;i++){

        setUploadPercent(i,newImages.length);

        const file = newImages[i];

        const ext = file.name

            .split(".")

            .pop()

            .toLowerCase();

        await uploadImage(

            file,

            `${slug}/chap${chapter}`,

            `${i+1}.${ext}`

        );

        log(

            `✔ ${i+1}.${ext}`

        );

        setUploadPercent(
    i + 1,
    newImages.length
);

    }

    await publishChapter({

        manga:slug,

        chapterNumber:chapter,

        title,

        imageCount:newImages.length

    });

    progress.innerHTML =

    "✔ Upload hoàn tất";

}

/* ===========================
        EDIT CHAPTER
=========================== */

async function saveChapter(){

    const folder = `${currentSlug}/chap${currentChapter}`;

    progress.innerHTML = "Đang upload ảnh mới...";

    log("Upload ảnh mới...");

    const total = newImages.length;

    let uploaded = 0;

    let nextIndex = existingImages.length + 1;

    for(const file of newImages){

        const ext = file.name
            .split(".")
            .pop()
            .toLowerCase();

        const filename = `${nextIndex}.${ext}`;

        await uploadImage(

            file,

            folder,

            filename

        );

        uploaded.push({

            name:filename

        });

        log(`✔ ${filename}`);

        nextIndex++;

        uploaded++;

    setUploadPercent(uploaded,total);

    }

    progress.innerHTML = "Đang sắp xếp ảnh...";

    const images = [

        ...existingImages,

        ...uploaded

    ].map(img=>({

        name:img.name

    }));

    await renameImages({

        manga:currentSlug,

        chapterId:currentChapter,

        images

    });

    progress.innerHTML = "Đang cập nhật chapter...";

    await updateChapter({

        manga:currentSlug,

        chapterId:currentChapter,

        title:chapterTitle.value.trim(),

        createAt:chapterDate.value,

        pages:images.length

    });

    progress.innerHTML = "✔ Hoàn tất";

    log("✔ Done");

}

/* ===========================
        RESET
=========================== */

function resetForm(){

    existingImages=[];

    newImages=[];

    preview.innerHTML="";

    uploadLog.innerHTML="";

    progress.innerHTML="";

    chapterFiles.value="";

    if(folderPicker){

        folderPicker.value="";

    }

    updateStats();

}

/* ===========================
        LOG
=========================== */

function log(text){

    const div =

    document.createElement("div");

    div.textContent = text;

    uploadLog.appendChild(div);

    uploadLog.scrollTop =

    uploadLog.scrollHeight;

}

function sortImages(){

    const all=[

        ...existingImages,

        ...newImages

    ];

    existingImages=[];

    newImages=[];

    all.forEach(img=>{

        if(img.type==="remote"){

            existingImages.push(img);

        }

        else{

            newImages.push(img);

        }

    });

}

addImageBtn.onclick = () => {
    chapterFiles.click();
};

function setUploadPercent(current,total){

    const percent = Math.round(current/total*100);

    progress.innerHTML = `

        <div class="progress-bar">

            <div
                class="progress-fill"
                style="width:${percent}%">
            </div>

        </div>

        <div id="progressText">

            ${current}/${total}
            (${percent}%)

        </div>

    `;

}