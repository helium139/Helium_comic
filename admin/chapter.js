import { requireAdmin }
from "../assets/js/adminGuard.js";

requireAdmin();

let mangas={};

fetch("../assets/data/data.json")

.then(r=>r.json())

.then(data=>{

    mangas=data;

    loadMangas();

});

function loadMangas(){

const select=document.getElementById("mangaSelect");

Object.entries(mangas)

.sort((a,b)=>

a[1].title.localeCompare(b[1].title)

)

.forEach(([slug,manga])=>{

select.innerHTML+=`

<option value="${slug}">

${manga.title}

</option>

`;

});

}

const imageInput=

document.getElementById("chapterImages");

imageInput.onchange=()=>{

document.getElementById("imageCount")

.innerHTML=

`${imageInput.files.length} ảnh`;

generateJson();

}

function generateJson(){

const pages=

imageInput.files.length;

const number=

parseInt(

document.getElementById("chapterNumber").value

);

const title=

document.getElementById("chapterTitle").value;

const folder=

document.getElementById("folderName").value;

const date=

document.getElementById("chapterDate").value;

const json={

id:number,

title:title,

createAt:date+"T07:00:00Z",

folder:

`https://pub-a0cc60d51c6e4ebab81ee134d3dada9e.r2.dev/${folder}`,

pages:pages

};

document.getElementById("jsonPreview")

.value=

JSON.stringify(json,null,4);

}

document

.querySelectorAll("input")

.forEach(input=>{

input.oninput=

generateJson;

});

document.getElementById("copyBtn")

.onclick=()=>{

navigator.clipboard.writeText(

document.getElementById("jsonPreview").value

);

alert("Đã copy.");

};

document.getElementById("downloadBtn")

.onclick=()=>{

const blob=new Blob(

[document.getElementById("jsonPreview").value],

{type:"application/json"}

);

const a=document.createElement("a");

a.href=URL.createObjectURL(blob);

a.download="chapter.json";

a.click();

};