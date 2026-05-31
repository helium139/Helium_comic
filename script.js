fetch("data/data.json")
  .then(res => res.json())
  .then(data => {

    

    const container =
        document.getElementById("comic-list");


        const mangas = Object.entries(data);

    // Chuyển DD/MM/YYYY -> timestamp
    const parseDate = (dateStr) => {
      const [day, month, year] = dateStr.split("/");
      return new Date(year, month - 1, day).getTime();
    };

    // Sắp xếp theo ngày chap mới nhất
    mangas.sort(([, a], [, b]) => {
      const aLast = a.chapters[a.chapters.length - 1];
      const bLast = b.chapters[b.chapters.length - 1];

      return parseDate(bLast.date) - parseDate(aLast.date);
    });


    container.innerHTML = "";

    mangas.forEach(([slug, manga]) => {
      const latestChap = manga.chapters[manga.chapters.length - 1];

      container.innerHTML += `
        <a href="comicpage.html?id=${slug}" class="comic-item">
          <div class="comic-poster">
            <img src="${manga.cover}" alt="${manga.title}">
          </div>

          <div class="comic-info">
            <h3 class="comic-name">${manga.title}</h3>
            <span class="comic-chapter">${latestChap.title}</span>
          </div>
        </a>
      `;
    });

  });