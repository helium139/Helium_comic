// Offline only: no Firebase SDK, network, credentials or apply mode.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function planStaffBootstrap(evidence, intent = {}) {
    if(evidence.project!=='helium-team-d7f80'||evidence.readOnly!==true)throw Error('Expected read-only project evidence');
    const blockers=[];
    if(evidence.auth.status!==200)blockers.push('Auth inventory unavailable');
    if(evidence.auth.truncated!==false)blockers.push('Auth inventory incomplete; claim-only staff beyond bounded page not ruled out');
    if(evidence.profiles.status!==200||evidence.profiles.truncated)blockers.push('Staff profile query incomplete');
    const auth=new Map([...evidence.auth.staff,...(evidence.auth.targetedLookup?.rows||[])].map(row=>[row.uid,row]));
    const profiles=new Map(evidence.profiles.staff.map(row=>[row.uid,row]));
    const current=new Map(evidence.current.map(row=>[row.uid,row]));
    const slots=new Map(evidence.slots.map(row=>[row.teamId,row]));
    const desired=new Map((intent.assignments||[]).map(row=>[row.uid,row]));
    const ids=[...new Set([...auth.keys(),...profiles.keys()])].sort();
    const items=ids.map(uid=>{
        const a=auth.get(uid),p=profiles.get(uid),c=current.get(uid);
        const override=desired.get(uid);
        // This changes the proposal, never the observed role or any live permission.
        const confirmedRepair=override?.source==='user-confirmed-intent'&&override.role==='admin'&&
            !override.teamId&&a?.role==='user'&&p?.role==='admin'&&!a.teamId&&!p.teamId;
        const effective=confirmedRepair?{...a,role:'admin',teamId:null}:a;
        const problems=[];
        if(!a)problems.push('No targeted Auth verification');
        if(!p)problems.push('Profile missing; do not infer a grant');
        if(a?.disabled)problems.push('Auth account disabled');
        if(a&&p&&!confirmedRepair&&(a.role!==p.role||(a.teamId||null)!==(p.teamId||null)||a.accessVersion!==p.accessVersion))
            problems.push('Auth/profile mismatch; never promote from profile alone');
        if(a&&!confirmedRepair&&!['admin','team_leader'].includes(a.role))problems.push('Not a staff grant in Auth');
        if(a?.role==='admin'&&a.teamId)problems.push('Admin must not have teamId');
        if(a?.role==='team_leader'&&!evidence.teams.some(t=>t.id===a.teamId&&t.active===true))problems.push('Unknown/inactive team');
        if(!c||![200,404].includes(c.status))problems.push('Authority observation unavailable');
        let proposedVersion=null,action='blocked';
        if(c?.status===404) {
            if(a?.accessVersion!==null||p?.accessVersion!==null)problems.push('Versioned identity without authority; inspect partial setup');
            else {proposedVersion=1;action='seed-pending-ack-active';}
        } else if(c?.status===200) {
            const row=c.value;
            if(row.state!=='active'||row.role!==a?.role||(row.teamId||null)!==(a?.teamId||null)||
                !Number.isSafeInteger(row.version)||row.version<1||row.version!==a?.accessVersion||row.version!==p?.accessVersion)
                problems.push('Existing authority needs recovery, not overwrite');
            else {proposedVersion=row.version;action='no-op';}
        }
        if(a?.role==='team_leader') {
            const slot=slots.get(a.teamId);
            if(!slot||![200,404].includes(slot.status))problems.push('Leader-slot observation unavailable');
            if(slot?.value?.uid&&slot.value.uid!==uid)problems.push('Leader slot already belongs to another UID');
            if(action==='no-op'&&slot?.value?.uid!==uid)problems.push('Active leader slot missing/inconsistent');
        }
        return {uid,observedAuth:a?{role:a.role,teamId:a.teamId,accessVersion:a.accessVersion,disabled:a.disabled}:null,
            observedProfile:p||null,proposed:problems.length?null:{role:effective.role,teamId:effective.teamId||null,version:proposedVersion},
            action:problems.length?'blocked':confirmedRepair?'proposed-admin-claims-repair':action,
            requiresSeparateRightsChangeApproval:confirmedRepair,
            preconditions:{authorityStatus:c?.status,observedAuth:a||null,observedProfile:p||null},problems};
    });
    const byTeam=new Map();
    for(const item of items)if(item.proposed?.role==='team_leader') {
        const team=item.proposed.teamId;
        if(!byTeam.has(team))byTeam.set(team,[]);
        byTeam.get(team).push(item);
    }
    for(const rows of byTeam.values())if(rows.length>1)for(const row of rows){
        row.problems.push('Two leaders would share one team');row.proposed=null;row.action='blocked';
    }
    const enabledObservedAdmins=[...auth.values()].filter(a=>a.role==='admin'&&!a.disabled).length;
    const plannedAdmins=items.filter(i=>i.proposed?.role==='admin').length;
    if(plannedAdmins<1||plannedAdmins<enabledObservedAdmins)blockers.push('Would lose an observed enabled admin or no verified admin remains');
    for(const item of items)if(item.problems.length)blockers.push(`UID ${item.uid}: ${item.problems.join('; ')}`);
    return {schemaVersion:1,dryRun:true,productionWrites:0,project:evidence.project,observedAt:evidence.checkedAt,
        readyForBootstrapReview:blockers.length===0,releaseApproved:false,enabledObservedAdmins,plannedAdmins,
        // This ordering is descriptive only, not an executable production writer.
        order:items.filter(i=>i.proposed).sort((a,b)=>(a.proposed.role==='admin'?0:1)-(b.proposed.role==='admin'?0:1)).map(i=>i.uid),
        items,blockers};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
    if(![3,4].includes(process.argv.length)||process.argv.slice(2).some(x=>x.startsWith('--')))throw Error('Usage: offline planner <private evidence JSON> [private intent JSON]; no apply mode');
    const intent=process.argv[3]?JSON.parse(await readFile(process.argv[3],'utf8')):{};
    const plan=planStaffBootstrap(JSON.parse(await readFile(process.argv[2],'utf8')),intent);
    await mkdir('.local-cms-build',{recursive:true});
    await writeFile('.local-cms-build/staff-bootstrap-plan.private.json',JSON.stringify(plan,null,2)+'\n');
    console.log(JSON.stringify({dryRun:true,productionWrites:0,ready:plan.readyForBootstrapReview,
        plannedAdmins:plan.plannedAdmins,itemCount:plan.items.length,blockerCount:plan.blockers.length,
        privateManifest:'.local-cms-build/staff-bootstrap-plan.private.json'}));
}
