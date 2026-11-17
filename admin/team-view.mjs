import { resolveMangaTeam } from '../assets/js/teams.js';

// Presentation only: callers must retain scopeMangas/backend authorization.
export function defaultTeamView(staff, teams, requestedManga) {
    if (staff.role !== 'admin') return staff.teamId;
    return requestedManga ? resolveMangaTeam(requestedManga, teams).id : 'heliumtg';
}

export function inTeamView(staff, manga, teams, teamId) {
    return resolveMangaTeam(manga, teams).id === (staff.role === 'admin' ? teamId : staff.teamId);
}

export function renderTeamView(select, staff, teams, selected, dom = document) {
    select.parentElement.hidden = staff.role !== 'admin';
    select.replaceChildren();
    for (const team of teams.filter(t => staff.role === 'admin' || t.id === staff.teamId)) {
        const option = dom.createElement('option');
        option.value = team.id;
        option.textContent = team.name + (team.active ? '' : ' (ngừng hoạt động)');
        select.appendChild(option);
    }
    select.value = selected;
}
