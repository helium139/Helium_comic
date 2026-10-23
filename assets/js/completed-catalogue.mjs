const collator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true });
export function completedEntries(catalogue, stats = [], search = '', sort = 'hot') {
    const views = new Map(stats.filter(entry => Number.isSafeInteger(entry.views) && entry.views >= 0)
        .map(entry => [entry.id, entry.views]));
    const needle = search.trim().toLocaleLowerCase('vi');
    const updated = manga => Math.max(0, ...(manga.chapters || []).map(chapter => Date.parse(chapter.createAt) || 0));
    return Object.entries(catalogue)
        .filter(([, manga]) => manga.status === 'Completed')
        .filter(([, manga]) => !needle || String(manga.title || '').toLocaleLowerCase('vi').includes(needle))
        .sort(([idA, a], [idB, b]) => {
            let difference;
            switch (sort) {
                case 'updated': difference = updated(b) - updated(a); break;
                case 'az': difference = collator.compare(a.title || '', b.title || ''); break;
                case 'za': difference = collator.compare(b.title || '', a.title || ''); break;
                default: difference = (views.get(idB) || 0) - (views.get(idA) || 0);
            }
            return difference || collator.compare(a.title || '', b.title || '') || idA.localeCompare(idB);
        });
}
