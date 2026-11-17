// Fixture-session controller only: never changes the historical guard/application tables.
export const table='authority_bench_validator_20261117';
export const sessionId='validator-20261117-v1';
export const gateSQL='SELECT verified,evidence_hash,free_features,free_expires FROM migration_gate WHERE id=1';
export function createSessionSQL({hash,expires}){
 if(!/^[a-f0-9]{64}$/.test(hash)||!Number.isSafeInteger(expires))throw Error('Pinned artifact/expiry required');
 return {sql:`CREATE TABLE ${table} AS SELECT ? AS id,118 AS requests,1148 AS read_reserved,465 AS write_reserved,0 AS business,0 AS sets,8 AS base_sets,0 AS completed,? AS expires,0 AS ready_until,1 AS enabled,1 AS verified,? AS evidence_hash,'["authority"]' AS free_features,? AS free_expires FROM fixture_budget WHERE id=1 AND requests=91 AND reserved_read=585 AND reserved_write=308 AND sets=8`,params:[sessionId,expires,hash,expires]};
}
export const reserveSQL=`UPDATE ${table} SET requests=requests+1,read_reserved=read_reserved+64,write_reserved=write_reserved+32,business=business+1,sets=sets+?,ready_until=CASE WHEN ready_until=0 THEN ? ELSE ready_until END WHERE id=? AND enabled=1 AND requests<130 AND business<12 AND read_reserved+64<=1916 AND write_reserved+32<=849 AND base_sets+sets+?<=12 AND expires>? AND (ready_until=0 OR ready_until>?) AND ?>? AND ?<=? RETURNING id`;
export function gateQuery(db,id){return db.prepare(`SELECT verified,evidence_hash,free_features,free_expires FROM ${table} WHERE id=? AND enabled=1`).bind(id);}
