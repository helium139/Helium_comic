const params =
    new URLSearchParams(
        window.location.search
    );

const mangaId =
    params.get("id");


    fetch("data/data.json")
.then(res => res.json())
.then(data => {

    const manga =
        data[mangaId];

    document.getElementById(
        "comic-title"
    ).textContent =
        manga.title;

    document.getElementById(
        "comic-cover"
    ).src =
        manga.cover;

    document.getElementById(
        "comic-author"
    ).textContent =
        manga.author;

    document.getElementById(
        "comic-team"
    ).textContent =
        manga.team;

    document.getElementById(
        "comic-status"
    ).textContent =
        manga.status;

    document.getElementById(
        "comic-description"
    ).textContent =
        manga.description;

    
const tagsContainer =
    document.getElementById(
        "comic-tags"
    );

    manga.tags.forEach(tag => {

    tagsContainer.innerHTML += `
        <span class="tag">
            ${tag}
        </span>
    `;

});

const chapterContainer =
    document.getElementById(
        "chapters-list"
    );

    manga.chapters.forEach(chap => {

    chapterContainer.innerHTML += `
        <div class="chapter-item">

            <a href="
                comicchap.html?id=${mangaId}&chap=${chap.id}">
                ${chap.title}
            </a>

            <span class="chapter-date">
                ${chap.date}
            </span>

        </div>
    `;
    console.log(
    `comicchap.html?id=${mangaId}&chap=${chap.id}`
);

});

});
