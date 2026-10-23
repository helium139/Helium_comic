// Existing fields are the only persisted source of truth; legacy typo is read-only compatibility.
export function orderedPicks(catalogue) {
    return Object.entries(catalogue).filter(([, manga]) => manga.adminPick === true)
        .sort((a, b) => order(a[1]) - order(b[1]));
}
function order(manga) {
    const value = manga.pickOrder ?? manga.pickOder;
    return Number.isFinite(value) ? value : 999;
}
export function setPick(catalogue, slug, selected) {
    let queue = orderedPicks(catalogue).map(([id]) => id);
    if (!selected) queue = queue.filter(id => id !== slug);
    else if (!queue.includes(slug)) queue.push(slug);
    queue = queue.slice(-10);
    for (const [id, manga] of Object.entries(catalogue)) {
        if (manga.adminPick === true || id === slug) {
            manga.adminPick = queue.includes(id);
            manga.pickOrder = manga.adminPick ? queue.indexOf(id) + 1 : 999;
        }
    }
    return queue;
}
