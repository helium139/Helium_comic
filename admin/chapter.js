import { requireAdmin }
from "../assets/js/adminGuard.js";

import {
    getMangas
}
from "./api/manga.js";

import {
    uploadImage
}
from "./api/upload.js";

import {
    publishChapter
}
from "./api/github.js";

import {
    buildChapter
}
from "./utils/builder.js";

import {
    log,
    clearLog
}
from "./utils/logger.js";

requireAdmin();

let mangas = {};

let selectedFiles = [];

//================ DOM =================//

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

const progress =
document.getElementById("progress");

// preview sẽ thêm vào chapter.html

const preview =
document.createElement("div");

preview.id = "preview";

preview.className = "preview-grid";

progress.parentNode.insertBefore(
    preview,
    progress
);

//================ INIT =================//

init();

async function init(){

    mangas =
        await getMangas();

    renderMangaList();

    setToday();

}
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

        `
        <option value="${slug}">
            ${manga.title}
        </option>
        `;

    });

    updateNextChapter();

}
function updateNextChapter(){

    const slug =
        mangaSelect.value;

    const manga =
        mangas[slug];

    const next =

        manga.chapters.length + 1;

    chapterNumber.value = next;

    chapterTitle.value =
        `Chap ${next}`;

}
function setToday(){

    const today =
        new Date();

    chapterDate.value =

        today
        .toISOString()
        .split("T")[0];

}
mangaSelect.onchange = ()=>{

    updateNextChapter();

};
chapterFiles.onchange = ()=>{

    selectedFiles =

        Array.from(
            chapterFiles.files
        );

    selectedFiles.sort(

        (a,b)=>

        a.name.localeCompare(
            b.name,
            undefined,
            {
                numeric:true
            }
        )

    );

    renderPreview();

};
function renderPreview(){

    preview.innerHTML = "";

    selectedFiles.forEach(

        (file,index)=>{

            const reader =
                new FileReader();

            reader.onload=e=>{

                preview.innerHTML +=

                `
                <div class="thumb">

                    <img
                        src="${e.target.result}"
                    >

                    <span>

                        ${index+1}

                    </span>

                </div>
                `;

            };

            reader.readAsDataURL(file);

        }

    );

}
function setProgress(text){

    progress.innerHTML = text;

    log(text);

}
//==================== UPLOAD ====================//

uploadBtn.onclick = async () => {

    if(selectedFiles.length === 0){

        alert("Chưa chọn ảnh.");

        return;

    }

    clearLog();

    uploadBtn.disabled = true;

    uploadBtn.textContent = "Đang upload...";

    try{

        await uploadChapter();

resetForm();

alert(
"Chapter đã được upload.\nGithub sẽ tự deploy khoảng 30-60 giây."
);

    }

    catch(err){

        console.error(err);

        alert(err.message);

    }

    uploadBtn.disabled = false;

    uploadBtn.innerHTML = `
        <i class='bx bx-cloud-upload'></i>
        Upload Chapter
    `;

};

async function uploadChapter(){

    const slug =
        mangaSelect.value;

    const chapter =
        Number(chapterNumber.value);

    const title =
        chapterTitle.value.trim();

    const date =
        chapterDate.value;

    const folder =
        `${slug}/chap${chapter}`;

    const uploadedUrls = [];

    setProgress("Bắt đầu upload...");

    for(let i=0;i<selectedFiles.length;i++){

        const file =
            selectedFiles[i];

        const extension =
            file.name
            .split(".")
            .pop();

        const filename =
            `${i+1}.${extension}`;

        setProgress(

            `Uploading ${filename}
             (${i+1}/${selectedFiles.length})`

        );

        const url =
            await uploadImage(

                file,

                folder,

                filename

            );

        uploadedUrls.push(url);

    }

    setProgress("Upload ảnh hoàn tất.");

    await commitChapter(

        slug,

        folder,

        title,

        chapter,

        date,

        uploadedUrls.length

    );

}
async function commitChapter(

    slug,

    folder,

    title,

    chapter,

    date,

    pages

){

    setProgress("Đang commit Github...");



    const result =

        await publishChapter({

            manga:slug,

            chapter:chapterObject

        });

    if(!result.success){

        throw new Error(

            result.message ||

            "Commit Github thất bại."

        );

    }

    setProgress("Commit thành công.");

    setProgress("Github Pages đang deploy...");

}
function resetForm(){

    selectedFiles = [];

    preview.innerHTML = "";

    chapterFiles.value = "";

    updateNextChapter();

}