fetch("data/data.json")
  .then(res => res.json())
  .then(data => {

    const container =
        document.getElementById("comic-list");

    Object.entries(data).forEach(
        ([slug, manga]) => {

        container.innerHTML += `
        <a href="comicpage.html?id=${slug}" class="comic-item">
            <div class="comic-poster">
                <img src="${manga.cover}" alt="${manga.title}">
            </div>

            <div class="comic-info">
                <h3 class="comic-name">${manga.title}</h3>
                <span class="comic-chapter">Chap ${manga.chapters.length}</span>
            </div>
            </a>
        `;
    });

  });