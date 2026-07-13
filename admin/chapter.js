import { requireAdmin } from "../assets/js/adminGuard.js";

import { getMangas } from "./api/manga.js";
import { uploadImage } from "./api/upload.js";
import { publishChapter } from "./api/github.js";

requireAdmin();

let mangas = {};
let selectedFiles = [];

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

    setToday();

    bindEvents();

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

    if(selectedFiles.length===0){

        alert("Chưa chọn ảnh.");

        return;

    }

    uploadBtn.disabled=true;

    uploadBtn.innerHTML="Uploading...";

    try{

        await uploadChapter();

        resetForm();

        alert(

"Upload thành công!\nGithub đang tự deploy website.\nKhoảng 30-60 giây sẽ cập nhật."

);

    }

    catch(err){

        console.error(err);

        alert(err.message);

    }

    uploadBtn.disabled=false;

    uploadBtn.innerHTML="Upload Chapter";

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
    if(selectedFiles.length===0){
    updateFileInfo();

    preview.innerHTML="";}

    if(selectedFiles.length===0){

        preview.innerHTML=`

        <div class="empty-preview">

            Chưa chọn ảnh

        </div>

        `;

        return;

    }

    selectedFiles.forEach((file,index)=>{

        const reader=new FileReader();

        reader.onload=e=>{

            const card=document.createElement("div");

            card.className="thumb";

            card.innerHTML=`

            <img src="${e.target.result}">

            <div class="thumb-index">

                ${index+1}

            </div>

            <div class="thumb-name">

                ${file.name}

            </div>

            <button

            class="remove-thumb"

            data-index="${index}"

            >

            ✕

            </button>

            `;

            preview.appendChild(card);

        };

        reader.readAsDataURL(file);

    });

}

/* ===========================
        REMOVE IMAGE
=========================== */

document.addEventListener("click",e=>{

    if(

        e.target.classList.contains(

            "remove-thumb"

        )

    ){

        const index=

        Number(

            e.target.dataset.index

        );

        selectedFiles.splice(index,1);

        renderPreview();

    }

});

/* ===========================
        PROGRESS
=========================== */

function setProgress(text){

    progress.innerHTML = text;

    log(text);

}
function updateFileInfo(){

    document.getElementById("fileCount").innerHTML =
        selectedFiles.length;

    const total =

        selectedFiles.reduce(

            (sum,file)=>sum+file.size,

            0

        );
         fileCount.innerHTML=

selectedFiles.length;

    document.getElementById("fileSize").innerHTML =
        (total/1024/1024).toFixed(2)+" MB";

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

    preview.innerHTML="";

    progress.innerHTML="";

    uploadLog.innerHTML="";

    updateNextChapter();

    updateFileInfo();

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