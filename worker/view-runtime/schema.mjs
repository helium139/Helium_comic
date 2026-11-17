// SQL triggers keep all decisions and effects inside D1's atomic batch transaction.
const keys = (prefix) => `SELECT ${prefix}.device AS k, 'reader' AS kind UNION ALL SELECT ${prefix}.account, 'reader' WHERE ${prefix}.account IS NOT NULL UNION ALL SELECT ${prefix}.network, 'network'`;
// Exact rolling-hour decision: the Nth newest accepted timestamp decides limit N.
// Keep the newest 10000 timestamps sorted, including across policy increases.
// The Nth newest timestamp answers the exact rolling-hour limit N in one lookup.
export const rateExceeded = (type, prefix, start = false) => `EXISTS(SELECT 1 FROM (${keys(prefix)}) k JOIN rates r ON r.id='${type}:'||k.k JOIN config c ON c.id=1 WHERE json_array_length(r.times)>=CASE WHEN k.kind='network' THEN c.${start?'networkSessionHourlyLimit':'networkHourlyLimit'} ELSE c.${start?'readerSessionHourlyLimit':'readerHourlyLimit'} END AND json_extract(r.times,'$['||(json_array_length(r.times)-CASE WHEN k.kind='network' THEN c.${start?'networkSessionHourlyLimit':'networkHourlyLimit'} ELSE c.${start?'readerSessionHourlyLimit':'readerHourlyLimit'} END)||']')>${prefix}.at-3600000)`;
function writeRates(type, prefix) {
 const reordered=`${prefix}.at<json_extract(rates.times,'$['||(json_array_length(rates.times)-1)||']')`;
 // Binary search takes <=15 recursive rows for <=10000 entries. Locate the
 // selected integer at a JSON delimiter, so equal values and different widths
 // cannot corrupt the array. No json_each scan or SQL sort on the slow path.
 // JSON is canonical (no whitespace), generated only here from integer millis.
 const inserted=`(WITH RECURSIVE search(lo,hi) AS (SELECT 0,json_array_length(rates.times) UNION ALL SELECT CASE WHEN json_extract(rates.times,'$['||((lo+hi)/2)||']')<${prefix}.at THEN (lo+hi)/2+1 ELSE lo END,CASE WHEN json_extract(rates.times,'$['||((lo+hi)/2)||']')<${prefix}.at THEN hi ELSE (lo+hi)/2 END FROM search WHERE lo<hi),position AS MATERIALIZED (SELECT CASE WHEN lo=0 THEN 1 ELSE instr(substr(rates.times,1,length(rates.times)-1)||',',','||json_extract(rates.times,'$['||lo||']')||',') END AS p FROM search WHERE lo=hi),inserted AS MATERIALIZED (SELECT substr(rates.times,1,p)||${prefix}.at||','||substr(rates.times,p+1) AS value FROM position) SELECT CASE WHEN json_array_length(rates.times)>=10000 THEN '['||substr(value,instr(value,',')+1) ELSE value END FROM inserted)`;
 const append=`CASE WHEN json_array_length(rates.times)<10000 THEN json_insert(rates.times,'$[#]',${prefix}.at) ELSE '['||substr(rates.times,instr(rates.times,',')+1,length(rates.times)-instr(rates.times,',')-1)||','||${prefix}.at||']' END`;
 return `INSERT INTO rates(id,times,delete_after) SELECT '${type}:'||k.k,json_array(${prefix}.at),${prefix}.at+7200000 FROM (${keys(prefix)}) k WHERE true ON CONFLICT(id) DO UPDATE SET times=CASE WHEN ${reordered} THEN ${inserted} ELSE ${append} END,delete_after=max(rates.delete_after,excluded.delete_after);`;
}
export const schema = `
PRAGMA foreign_keys=ON;
CREATE TABLE transfer_mode(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)));
INSERT INTO transfer_mode VALUES(1,0);
CREATE TABLE view_writer(id INTEGER PRIMARY KEY CHECK(id=1),epoch TEXT NOT NULL);
INSERT INTO view_writer VALUES(1,'cloudflare-staging');
CREATE TABLE config(id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL, activation INTEGER NOT NULL, version TEXT NOT NULL, readerHourlyLimit INTEGER NOT NULL, networkHourlyLimit INTEGER NOT NULL, readerSessionHourlyLimit INTEGER NOT NULL, networkSessionHourlyLimit INTEGER NOT NULL, CHECK(readerHourlyLimit BETWEEN 1 AND 10000 AND networkHourlyLimit BETWEEN 1 AND 10000 AND readerSessionHourlyLimit BETWEEN 1 AND 10000 AND networkSessionHourlyLimit BETWEEN 1 AND 10000));
CREATE TABLE sessions(id TEXT PRIMARY KEY, uid TEXT, device TEXT NOT NULL, account TEXT, network TEXT NOT NULL, team TEXT NOT NULL,manga TEXT NOT NULL,chapter TEXT NOT NULL,revision TEXT NOT NULL, activation INTEGER NOT NULL, version TEXT NOT NULL, started INTEGER NOT NULL, expires INTEGER NOT NULL, delete_after INTEGER NOT NULL, at INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0, accepted INTEGER, reason TEXT, record_revision TEXT, record_uid TEXT,device_dedup TEXT,account_dedup TEXT) WITHOUT ROWID;
CREATE TABLE rates(id TEXT PRIMARY KEY, times TEXT NOT NULL CHECK(json_valid(times) AND json_type(times)='array' AND json_array_length(times) BETWEEN 1 AND 10000), delete_after INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE dedup(id TEXT PRIMARY KEY, eligible INTEGER NOT NULL, delete_after INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE events(id TEXT PRIMARY KEY, team TEXT NOT NULL,manga TEXT NOT NULL,chapter TEXT NOT NULL,uid TEXT,device TEXT NOT NULL,at INTEGER NOT NULL,month TEXT NOT NULL,activation INTEGER NOT NULL,version TEXT NOT NULL,revision TEXT NOT NULL,session_revision TEXT NOT NULL,valid INTEGER NOT NULL CHECK(valid=1),epoch TEXT NOT NULL) WITHOUT ROWID;
CREATE INDEX event_month ON events(month);
CREATE TRIGGER immutable_events_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'immutable-event'); END;
CREATE TRIGGER immutable_events_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'immutable-event'); END;
CREATE TABLE reports(month TEXT PRIMARY KEY, hash TEXT NOT NULL, snapshot TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE report_chunks(month TEXT NOT NULL,part INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(month,part)) WITHOUT ROWID;
CREATE TRIGGER immutable_chunks_update BEFORE UPDATE ON report_chunks BEGIN SELECT RAISE(ABORT,'immutable-report-chunk'); END;
CREATE TRIGGER immutable_chunks_delete BEFORE DELETE ON report_chunks BEGIN SELECT RAISE(ABORT,'immutable-report-chunk'); END;
CREATE TRIGGER immutable_reports_update BEFORE UPDATE ON reports BEGIN SELECT RAISE(ABORT,'immutable-report'); END;
CREATE TRIGGER immutable_reports_delete BEFORE DELETE ON reports BEGIN SELECT RAISE(ABORT,'immutable-report'); END;
CREATE TRIGGER start_check BEFORE INSERT ON sessions WHEN (SELECT enabled FROM transfer_mode WHERE id=1)=0 AND NOT EXISTS(SELECT 1 FROM sessions WHERE id=NEW.id) BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM config WHERE id=1 AND enabled=1 AND activation<=NEW.at AND activation=NEW.activation AND version=NEW.version) THEN RAISE(ABORT,'policy-changed') END;
 SELECT CASE WHEN ${rateExceeded('starts','NEW',true)} THEN RAISE(ABORT,'start-rate-limited') END;
END;
CREATE TRIGGER start_rates AFTER INSERT ON sessions WHEN (SELECT enabled FROM transfer_mode WHERE id=1)=0 BEGIN ${writeRates('starts','NEW')} END;
CREATE TRIGGER record_check BEFORE UPDATE OF consumed ON sessions WHEN OLD.consumed=0 AND NEW.consumed=1 BEGIN
 SELECT CASE WHEN OLD.expires<=NEW.at THEN RAISE(ABORT,'expired') WHEN NEW.at-OLD.started<10000 THEN RAISE(ABORT,'too-early') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM config WHERE id=1 AND enabled=1 AND activation<=NEW.at AND activation=OLD.activation AND version=OLD.version) THEN RAISE(ABORT,'policy-changed') END;
END;
CREATE TRIGGER record_effects AFTER UPDATE OF consumed ON sessions WHEN OLD.consumed=0 AND NEW.consumed=1 AND NEW.accepted=1 BEGIN
 INSERT INTO events SELECT NEW.id,NEW.team,NEW.manga,NEW.chapter,NEW.record_uid,NEW.device,NEW.at,strftime('%Y-%m',NEW.at/1000,'unixepoch'),NEW.activation,NEW.version,NEW.record_revision,NEW.revision,1,(SELECT epoch FROM view_writer WHERE id=1);
 INSERT INTO dedup(id,eligible,delete_after) SELECT k.id,NEW.at+86400000,NEW.at+172800000 FROM (SELECT NEW.device_dedup AS id UNION ALL SELECT NEW.account_dedup WHERE NEW.account_dedup IS NOT NULL) k WHERE true ON CONFLICT(id) DO UPDATE SET eligible=excluded.eligible,delete_after=excluded.delete_after;
 ${writeRates('accepted','NEW')}
END;`;

export async function installSchema(db) {
 let pending='';
 for(const line of schema.split('\n').map(s=>s.trim()).filter(Boolean)) {
  pending+=(pending?' ':'')+line;
  if(pending.startsWith('CREATE TRIGGER')&&line!=='END;'&&!(line.startsWith('CREATE TRIGGER')&&line.endsWith('END;'))) continue;
  await db.prepare(pending).run();pending='';
 }
 if(pending) throw new Error('Incomplete schema');
}
