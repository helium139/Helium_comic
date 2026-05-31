const params = new URLSearchParams(
    window.location.search
);

const mangaId = params.get("id");
const chapterId = parseInt(
    params.get("chap")
);

fetch("data/data.json")
.then(res => res.json())
.then(data => {

    const manga = data[mangaId];

    const chapter = manga.chapters.find(
        c => c.id === chapterId
    );

    // ===== TITLE =====

    document.getElementById(
        "chapter-title"
    ).innerHTML = `
        ${manga.title}
        - ${chapter.title}

        <span class="update-time">
            (${chapter.date})
        </span>
    `;

    // ===== BREADCRUMB =====

    document.getElementById(
        "breadcrumb"
    ).innerHTML = `
        <a href="index.html">
            Trang Chủ
        </a>

        &gt;

        <a href="comicpage.html?id=${mangaId}">
            ${manga.title}
        </a>

        &gt;

        ${chapter.title}
    `;

    // ===== LOAD IMAGES =====

    const reader =
        document.getElementById(
            "chapter-content"
        );

    for(
    let i = 1;
    i <= chapter.pages;
    i++
){

    const imageUrl =
        `${chapter.folder}/${i}.jpg`;

    reader.innerHTML += `
        <img
            src="${imageUrl}"
            loading="lazy"
            alt="page ${i}"
        >
    `;
}


    // ===== CHAP TRƯỚC / SAU =====

    const currentIndex =
        manga.chapters.findIndex(
            c => c.id === chapterId
        );

    if(currentIndex > 0){

        const prev =
            manga.chapters[
                currentIndex - 1
            ];

        document.getElementById(
            "prev-btn"
        ).href =
        `comicchap.html?id=${mangaId}&chap=${prev.id}`;
    }

    if(
        currentIndex <
        manga.chapters.length - 1
    ){

        const next =
            manga.chapters[
                currentIndex + 1
            ];

        document.getElementById(
            "next-btn"
        ).href =
        `comicchap.html?id=${mangaId}&chap=${next.id}`;
    }
    if(currentIndex > 0){

        const prev =
            manga.chapters[
                currentIndex - 1
            ];

        document.getElementById(
            "toolbar-prev"
        ).href =
        `comicchap.html?id=${mangaId}&chap=${prev.id}`;
    }

    if(
        currentIndex <
        manga.chapters.length - 1
    ){

        const next =
            manga.chapters[
                currentIndex + 1
            ];

        document.getElementById(
            "toolbar-next"
        ).href =
        `comicchap.html?id=${mangaId}&chap=${next.id}`;
    }

    const select =
document.getElementById("chapSelect");

manga.chapters.forEach(chap => {

    select.innerHTML += `
        <option value="${chap.id}">
            ${chap.title}
        </option>
    `;

});
    select.value = chapterId;

    select.addEventListener(
    "change",
    function(){

        window.location.href =
        `comicchap.html?id=${mangaId}&chap=${this.value}`;

    }
);
});

const scrollBtn =
    document.getElementById("scrollTopBtn");

window.addEventListener("scroll", () => {

    if (window.scrollY > 500) {
        scrollBtn.style.display = "flex";
    } else {
        scrollBtn.style.display = "none";
    }

});

scrollBtn.addEventListener("click", () => {

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });

});

