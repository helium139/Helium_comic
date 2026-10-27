import { scopeMangas, assertCanManageManga, showStaffAccessError } from "../assets/js/staff-access.js";
import { chapterUrl } from "../assets/js/routes.js";
import { requireStaff } from "../assets/js/adminGuard.js";
import { getMangas } from "./api/manga.js";
import { bindUploadProgress, paintProgress, settleUploadProgress } from "./upload-progress.mjs";
import { uploadImage } from "./api/upload.js";
import {
    publishChapter,
    updateChapter
} from "./api/github.js";

const currentStaff = await requireStaff();

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
let previewObjectUrls = [];
let pageOrder = [];
const stagedEditImages = new Set();
const stagedEditFiles = new Map();

/* ===========================
        DOM
=========================== */

const mangaSelect = document.getElementById("mangaSelect");
const chapterNumber = document.getElementById("chapterNumber");
const rawCaughtUp = document.getElementById("isRawCaughtUp");
const chapterTitle = document.getElementById("chapterTitle");
const chapterDate = document.getElementById("chapterDate");

const chapterFiles = document.getElementById("chapterFiles");
const folderPicker = document.getElementById("folderPicker");

const uploadBtn = document.getElementById("uploadBtn");

const preview = document.getElementById("preview");

const dropZone = document.getElementById("dropZone");

const uploadLog = document.getElementById("uploadLog");

const progress = document.getElementById("progress");
let uploadProgress;

const fileCount = document.getElementById("fileCount");

const fileSize = document.getElementById("fileSize");

const addImageBtn = document.getElementById("addImageBtn");
/* ===========================
        INIT
=========================== */

await init().catch(showStaffAccessError);

async function init(){

    mangas = scopeMangas(currentStaff, await getMangas());

    parseQuery();
    const requestedManga = new URLSearchParams(location.search).get("manga");
    if (requestedManga) assertCanManageManga(currentStaff, mangas[requestedManga]);

    renderMangaList();
    if (requestedManga) mangaSelect.value = requestedManga;

    bindEvents();

    if(mode==="edit"){

        await loadEditor();

    }

    else{

        setToday();

        updateNextChapter();

    }

    uploadProgress = bindUploadProgress(progress);

}

/* ===========================
        QUERY
=========================== */

function parseQuery(){

    const params = new URLSearchParams(location.search);

    const slug = params.get("manga");

    const chapter = Number(params.get("chapter"));
    if (slug) currentSlug = slug;

    if(slug && params.has("chapter") && Number.isFinite(chapter)){

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
        if (slug === currentSlug || manga.status !== "Hiatus" && manga.status !== "Completed")
    {

        mangaSelect.innerHTML +=

        `<option value="${slug}">

            ${manga.title}

        </option>`;
        }

    });
}



function updateNextChapter(){

    const manga = mangas[mangaSelect.value];
    rawCaughtUp.checked = manga?.isRawCaughtUp === true;

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

    const manga = mangas[currentSlug];
    assertCanManageManga(currentStaff, manga);
    mangaSelect.value = currentSlug;
    rawCaughtUp.checked = manga.isRawCaughtUp === true;
    mangaSelect.disabled = true;

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

            name:chapter.images?.[i-1] || `${i}.jpg`,

            url:`${chapter.folder}/${chapter.images?.[i-1] || `${i}.jpg`}`,

            sourceType: "existing"

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
        if (uploadBtn.disabled) return;

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

    for (const url of previewObjectUrls) URL.revokeObjectURL(url);
    previewObjectUrls = [];

    preview.innerHTML = "";

    const selected = [

        ...existingImages,

        ...newImages

    ];
    pageOrder = pageOrder.filter(img => selected.includes(img));
    for (const img of selected) if (!pageOrder.includes(img)) pageOrder.push(img);
    const images = pageOrder;

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
        image.loading = 'lazy';
        image.decoding = 'async';

        if(img.type==="remote"){

            image.src = img.url;

        }

        else{

            const url = URL.createObjectURL(img);
            previewObjectUrls.push(url);
            image.onload = image.onerror = () => URL.revokeObjectURL(url);
            image.src = url;

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

    const all = [...pageOrder];

    const moved=all.splice(

        e.oldIndex,

        1

    )[0];

    all.splice(

        e.newIndex,

        0,

        moved

    );
    pageOrder = all;

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
    if (uploadBtn.disabled) return;

    const btn = e.target.closest(

        ".remove-thumb"

    );

    if(!btn) return;

    const index = Number(

        btn.dataset.index

    );

    const target = pageOrder[index];
    const existingIndex = existingImages.indexOf(target);
    if(existingIndex !== -1){

        existingImages.splice(

            existingIndex,

            1

        );

    }

    else{

        newImages.splice(

            newImages.indexOf(target),

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
    if (uploadBtn.disabled) return;
    uploadProgress.reset(pageOrder.length || newImages.length);
    uploadLog.textContent = '';
    document.getElementById('chapterLinkBox')?.classList.add('hidden');

    uploadBtn.disabled = true;
    const controls = [...document.querySelectorAll('input, select, textarea, button')].filter(control => control !== uploadBtn);
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    sortable?.option('disabled', true);

    uploadBtn.innerHTML =

    "Đang lưu...";

    const isRawCaughtUp = rawCaughtUp?.checked === true;

    try{

        if(mode==="new"){

            await uploadChapter(isRawCaughtUp);

        }

        else{

            await saveChapter(isRawCaughtUp);

        }

        mangas[mangaSelect.value].isRawCaughtUp = isRawCaughtUp;
        uploadProgress.complete();
        await settleUploadProgress(progress);
        alert("Đã lưu thành công.");

    }

    catch(err){

        console.error(err);
        uploadProgress.fail(err.message);
        await paintProgress();
        alert(err.message);

    }

    uploadBtn.disabled = false;
    controls.forEach((control, index) => { control.disabled = disabled[index]; });
    sortable?.option('disabled', false);

    uploadBtn.innerHTML =

    mode==="edit"

    ? "<i class='bx bx-save'></i> Lưu thay đổi"

    : "<i class='bx bx-upload'></i> Upload Chapter";

}

/* ===========================
        NEW CHAPTER
=========================== */

async function uploadChapter(isRawCaughtUp = false){

    const slug = mangaSelect.value;
    assertCanManageManga(currentStaff, mangas[slug]);

    const chapter = Number(

        chapterNumber.value

    );

    // Avoid uploading orphan replacements when “New chapter” targets an existing record.
    if (mangas[slug].chapters?.some(item => Number(item.id) === chapter)) {
        throw new Error('Chapter already exists. Open Edit chapter to replace or reorder its pages.');
    }

    const title =

        chapterTitle.value.trim();

    if(!title){

        throw new Error(

            "Chưa nhập tiêu đề."

        );

    }

    // Snapshot the displayed order; upload indices become final published page numbers.
    const orderedImages = [...(pageOrder.length ? pageOrder : newImages)];
    if (!orderedImages.length) throw new Error('Chưa chọn ảnh chapter.');
    uploadProgress.prepared();
    await paintProgress();
    const filenames = [];
    for(let i=0;i<orderedImages.length;i++){

        const file = orderedImages[i];

        const ext = file.name

            .split(".")

            .pop()

            .toLowerCase();

        const uploadedUrl = await uploadImage(

            file,

            `${slug}/chap${chapter}`,

            `${i+1}.${ext}`,
            uploadProgressOptions(i, file)

        );

        filenames.push(uploadedUrl.split('/').pop());
        log(

            `✔ ${filenames[i]}`

        );

    }

    uploadProgress.publishing();
    await paintProgress();
    await publishChapter({
        isRawCaughtUp: isRawCaughtUp === true,

        manga:slug,

        chapterNumber:chapter,

        title,

        imageCount:orderedImages.length,
        images: filenames

    });

    uploadProgress.published();
    await paintProgress();

        const link =
`https://heliumtg.com${chapterUrl(slug, chapter)}`;

chapterLink.value = link;

chapterLinkBox.classList.remove("hidden");

const copyChapterLink = document.getElementById("copyChapterLink");

    copyChapterLink.onclick=async()=>{

    await navigator.clipboard.writeText(

        chapterLink.value

    );

    copyChapterLink.textContent="Đã copy";

    setTimeout(()=>{

        copyChapterLink.textContent="Copy";

    },1500);

};
    

}

/* ===========================
        EDIT CHAPTER
=========================== */

async function saveChapter(isRawCaughtUp = false){
    assertCanManageManga(currentStaff, mangas[currentSlug]);

    const rootFolder = `${currentSlug}/chap${currentChapter}`;
    const orderedImages = [...pageOrder];
    if (!orderedImages.length) throw new Error('Chưa chọn ảnh chapter.');
    if (new Set(orderedImages).size !== orderedImages.length ||
        orderedImages.some(image => image.type === "remote"
            ? !image.name || image.sourceType !== "existing"
            : !image.name || typeof image.slice !== "function")) {
        throw new Error('Danh sách ảnh chapter không hợp lệ.');
    }
    uploadProgress.prepared();
    await paintProgress();
    const sources = [];
    for (let index = 0; index < orderedImages.length; index++) {
        const image = orderedImages[index];
        if (image.type === "remote") {
            sources.push({ type: "existing", name: image.name });
            uploadProgress.converted(index);
            uploadProgress.uploaded(index);
            continue;
        }

        let stagingName = stagedEditFiles.get(image);
        if (!stagingName) {
            const extension = image.name.split(".").pop().toLowerCase();
            const uploadedUrl = await uploadImage(
                image,
                rootFolder,
                `${index + 1}.${extension}`,
                uploadProgressOptions(index, image)
            );
            stagingName = uploadedUrl.split("/").pop();
            stagedEditFiles.set(image, stagingName);
            stagedEditImages.add(stagingName);
            log(`✔ ${stagingName}`);
        } else {
            uploadProgress.converted(index);
            uploadProgress.uploaded(index);
        }
        sources.push({ type: "staged", name: stagingName });
    }

    uploadProgress.reordered();
    await paintProgress();

    const result = await updateChapter({
        isRawCaughtUp: isRawCaughtUp === true,

        manga: currentSlug,

        chapterId: currentChapter,

        title: chapterTitle.value.trim(),

        createAt: new Date(chapterDate.value)
            .toISOString(),

        pages: orderedImages.length,
        images: sources,
        stagedImages: [...stagedEditImages]

    });

    uploadProgress.published();
    await paintProgress();

    const updatedChapter = result.chapter;
    if (!updatedChapter || !Array.isArray(updatedChapter.images) || updatedChapter.images.length !== sources.length) {
        throw new Error('Worker did not return the committed chapter image list; reload before retrying.');
    }
    mangas[currentSlug].chapters = mangas[currentSlug].chapters.map(chapter =>
        Number(chapter.id) === Number(currentChapter) ? updatedChapter : chapter);
    existingImages = updatedChapter.images.map(name => {
        const url = `${updatedChapter.folder}/${name}`;
        return { type: "remote", sourceType: "existing", name, url };
    });

    newImages = [];
    pageOrder = [...existingImages];
    stagedEditImages.clear();
    stagedEditFiles.clear();

    renderPreview();

    log("✔ Chapter updated");

     const link =
`https://heliumtg.com${chapterUrl(currentSlug, currentChapter)}`;

chapterLink.value = link;

chapterLinkBox.classList.remove("hidden");

const copyChapterLink = document.getElementById("copyChapterLink");

    copyChapterLink.onclick=async()=>{

    await navigator.clipboard.writeText(

        chapterLink.value

    );

    copyChapterLink.textContent="Đã copy";

    setTimeout(()=>{

        copyChapterLink.textContent="Copy";

    },1500);
    };

}

/* ===========================
        RESET
=========================== */

function resetForm(){

    existingImages=[];

    newImages=[];

    pageOrder=[];

    stagedEditImages.clear();

    stagedEditFiles.clear();

    preview.innerHTML="";

    uploadLog.innerHTML="";

    uploadProgress.reset();

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

function uploadProgressOptions(index, file) {
    return { onProgress: async (phase, details) => {
        if (phase === 'converting') uploadProgress.converting(index);
        if (phase === 'preserved') log(`Giữ nguyên JPG: ${details?.filename || file.name}`);
        if (phase === 'converted') uploadProgress.converted(index);
        if (phase === 'uploaded') uploadProgress.uploaded(index);
        await paintProgress();
    } };
}
