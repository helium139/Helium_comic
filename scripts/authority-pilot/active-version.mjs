// Legacy upload ID is compared to normalized version ID, never deployment object's ID.
export function identifyActiveVersion(listed,legacyUploadId){
 const list=Array.isArray(listed)?listed:listed?.deployments,active=list?.[0],version=active?.versions?.[0];
 if(!Array.isArray(list)||!list.length||active.versions?.length!==1||version.percentage!==100||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(version.version_id||'')||!/^[a-f0-9]{32}$/.test(legacyUploadId||'')||version.version_id.replaceAll('-','')!==legacyUploadId)throw Error('Uploaded version does not match single active100%version');
 return {deploymentId:active.id,created_on:active.created_on,versionId:version.version_id,percentage:version.percentage,legacyUploadMatchesVersion:true};
}
