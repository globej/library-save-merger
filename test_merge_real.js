// Regression harness: runs merger.js against backups resembling a real JW Library
// userData.db (Notes, Tags, TagMap, UserMark/BlockRange, Playlists, media, markers,
// metadata) and asserts that nothing is dropped and foreign keys are remapped.
const JSZip = require('jszip');
const initSqlJs = require('sql.js');

global.window = {};
global.JSZip = JSZip;
global.initSqlJs = () => initSqlJs();
global.defaultThumbnailBase64 = undefined;
global.crypto = require('crypto').webcrypto;
global.console.warn = () => {};
require('./merger.js');

const SCHEMA = `
  CREATE TABLE Location (LocationId INTEGER PRIMARY KEY, BookNumber INT, ChapterNumber INT, DocumentId INT, Track INT, IssueTagNumber INT, KeySymbol TEXT, MepsLanguage INT, Type INT, Title TEXT, Specialty TEXT, Edition TEXT);
  CREATE TABLE UserMark (UserMarkId INTEGER PRIMARY KEY, ColorIndex INT, LocationId INT, StyleIndex INT, UserMarkGuid TEXT UNIQUE, Version INT);
  CREATE TABLE BlockRange (BlockRangeId INTEGER PRIMARY KEY, BlockType INT, Identifier INT, StartToken INT, EndToken INT, UserMarkId INT);
  CREATE TABLE Bookmark (BookmarkId INTEGER PRIMARY KEY, LocationId INT, PublicationLocationId INT, Slot INT, Title TEXT, Snippet TEXT, BlockType INT, BlockIdentifier INT);
  CREATE TABLE Note (NoteId INTEGER PRIMARY KEY, Guid TEXT, UserMarkId INT, LocationId INT, Title TEXT, Content TEXT, LastModified TEXT, Created TEXT, BlockType INT, BlockIdentifier INT);
  CREATE TABLE Tag (TagId INTEGER PRIMARY KEY, Type INT, Name TEXT);
  CREATE TABLE TagMap (TagMapId INTEGER PRIMARY KEY, PlaylistItemId INT, LocationId INT, NoteId INT, TagId INT, Position INT, CONSTRAINT TagId_Position UNIQUE (TagId, Position), CONSTRAINT TagId_NoteId UNIQUE (TagId, NoteId), CONSTRAINT TagId_LocationId UNIQUE (TagId, LocationId));
  CREATE TABLE InputField (LocationId INT, TextTag TEXT, Value TEXT, PRIMARY KEY (LocationId, TextTag));
  CREATE TABLE IndependentMedia (IndependentMediaId INTEGER PRIMARY KEY, OriginalFilename TEXT, FilePath TEXT UNIQUE, MimeType TEXT, Hash TEXT);
  CREATE TABLE PlaylistItem (PlaylistItemId INTEGER PRIMARY KEY, Label TEXT, StartTrimOffsetTicks INT, EndTrimOffsetTicks INT, Accuracy INT, EndAction INT, ThumbnailFilePath TEXT);
  CREATE TABLE PlaylistItemAccuracy (PlaylistItemAccuracyId INTEGER PRIMARY KEY, Description TEXT);
  CREATE TABLE PlaylistItemIndependentMediaMap (PlaylistItemId INT, IndependentMediaId INT, DurationTicks INT, PRIMARY KEY (PlaylistItemId, IndependentMediaId));
  CREATE TABLE PlaylistItemLocationMap (PlaylistItemId INT, LocationId INT, MajorMultimediaType INT, BaseDurationTicks INT, PRIMARY KEY (PlaylistItemId, LocationId));
  CREATE TABLE PlaylistItemMarker (PlaylistItemMarkerId INTEGER PRIMARY KEY, PlaylistItemId INT, Label TEXT, StartTimeTicks INT, DurationTicks INT, EndTransitionDurationTicks INT);
  CREATE TABLE PlaylistItemMarkerBibleVerseMap (PlaylistItemMarkerId INT, VerseId INT, PRIMARY KEY (PlaylistItemMarkerId, VerseId));
  CREATE TABLE PlaylistItemMarkerParagraphMap (PlaylistItemMarkerId INT, MepsDocumentId INT, ParagraphIndex INT, MarkerIndexWithinParagraph INT, PRIMARY KEY (PlaylistItemMarkerId, MepsDocumentId, ParagraphIndex));
  CREATE TABLE LastModified (LastModified TEXT);
  CREATE TABLE android_metadata (locale TEXT);
  CREATE UNIQUE INDEX IX_Note_Guid ON Note (Guid);
`;

async function build(SQL, sqls, extraFiles) {
    const db = new SQL.Database();
    db.run(SCHEMA);
    for (const s of sqls) db.run(s);
    const z = new JSZip();
    z.file('userData.db', db.export());
    z.file('manifest.json', JSON.stringify({ name: 'b', creationDate: '2024-01-01', version: 1, type: 0, userDataBackup: { lastModifiedDate: '2024-01-01T00:00:00Z', hash: 'x', deviceName: 'd', databaseName: 'userData.db', schemaVersion: 14 } }));
    // Real Android backups can ship SQLite sidecar journals alongside the db.
    for (const [name, content] of Object.entries(extraFiles || {})) z.file(name, content);
    db.close();
    return z.generateAsync({ type: 'nodebuffer' });
}

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ FAIL: ' + msg); } }

(async () => {
    const SQL = await initSqlJs();

    const A = await build(SQL, [
        `INSERT INTO Location VALUES (1,1,NULL,NULL,NULL,NULL,'nwtsty',0,0,NULL,NULL,NULL);`,
        `INSERT INTO Note VALUES (1,'guid-A-only',NULL,1,'NoteA','content A','2024-01-01T00:00:00Z','2024-01-01T00:00:00Z',NULL,NULL);`,
        `INSERT INTO Note VALUES (2,'guid-shared',NULL,1,'Shared','old text','2024-01-01T00:00:00Z','2024-01-01T00:00:00Z',NULL,NULL);`,
        `INSERT INTO Tag VALUES (1,1,'Study');`,
        `INSERT INTO TagMap VALUES (1,NULL,NULL,1,1,0);`,
        // Shared "Favorites" tag (same Type+Name in both backups -> merged into one TagId).
        // A tags its own note here at Position 0; B tags a different note at Position 0 too,
        // which would collide on UNIQUE(TagId, Position) after the tags merge.
        `INSERT INTO Tag VALUES (3,1,'Favorites');`,
        `INSERT INTO TagMap VALUES (3,NULL,NULL,1,3,0);`,
        // Shared "Reading" tag holding the shared note (guid-shared, NoteId 2). A puts it at
        // Position 0; B (below) puts the SAME note in the SAME tag at Position 5. Keying dedup
        // on Position would keep both and blow the UNIQUE(TagId, NoteId) constraint.
        `INSERT INTO Tag VALUES (4,1,'Reading');`,
        `INSERT INTO TagMap VALUES (4,NULL,NULL,2,4,0);`,
        // A playlist: Tag(Type=2) + 1 item + media + location + marker
        `INSERT INTO Tag VALUES (2,2,'My Playlist');`,
        `INSERT INTO IndependentMedia VALUES (1,'songA.mp3','/a','audio/mpeg','hashA');`,
        // Media file also present in backup B with the SAME FilePath ('/shared'): must be
        // merged to one row, not concatenated, or UNIQUE(FilePath) aborts the merge.
        `INSERT INTO IndependentMedia VALUES (2,'shared.mp3','/shared','audio/mpeg','hashS');`,
        `INSERT INTO PlaylistItem VALUES (1,'Item A',0,0,1,0,NULL);`,
        `INSERT INTO TagMap VALUES (2,1,NULL,NULL,2,0);`,
        `INSERT INTO PlaylistItemIndependentMediaMap VALUES (1,1,1000);`,
        `INSERT INTO PlaylistItemLocationMap VALUES (1,1,1,500);`,
        `INSERT INTO PlaylistItemMarker VALUES (1,1,'MarkA',0,100,0);`,
        `INSERT INTO PlaylistItemMarkerBibleVerseMap VALUES (1,42);`,
        `INSERT INTO PlaylistItemMarkerParagraphMap VALUES (1,7,3,0);`,
        `INSERT INTO PlaylistItemAccuracy VALUES (1,'Accurate');`,
        `INSERT INTO LastModified VALUES ('2024-01-01T00:00:00Z');`,
        `INSERT INTO android_metadata VALUES ('en_US');`,
    ], {
        // Stale SQLite journals as found in a real Android backup: they must NOT be
        // carried into the merged output, or the app replays them over the merge.
        'userData.db-wal': Buffer.from('STALE-WAL-DATA'),
        'userData.db-shm': Buffer.from('STALE-SHM-DATA'),
    });
    const mergeStartMs = Date.now();

    const B = await build(SQL, [
        `INSERT INTO Location VALUES (1,1,NULL,NULL,NULL,NULL,'nwtsty',0,0,NULL,NULL,NULL);`,
        `INSERT INTO Note VALUES (1,'guid-B-only',NULL,1,'NoteB','content B','2024-02-01T00:00:00Z','2024-02-01T00:00:00Z',NULL,NULL);`,
        `INSERT INTO Note VALUES (2,'guid-shared',NULL,1,'Shared','NEW text','2024-03-01T00:00:00Z','2024-01-01T00:00:00Z',NULL,NULL);`,
        // B playlist: different item + media + marker
        `INSERT INTO Tag VALUES (1,2,'B Playlist');`,
        `INSERT INTO IndependentMedia VALUES (1,'songB.mp3','/b','audio/mpeg','hashB');`,
        // Same shared media file ('/shared') as backup A.
        `INSERT INTO IndependentMedia VALUES (2,'shared.mp3','/shared','audio/mpeg','hashS');`,
        `INSERT INTO PlaylistItem VALUES (1,'Item B',0,0,1,0,NULL);`,
        `INSERT INTO TagMap VALUES (1,1,NULL,NULL,1,0);`,
        // Same "Favorites" tag as A; its note also sits at Position 0 (collision source).
        `INSERT INTO Tag VALUES (2,1,'Favorites');`,
        `INSERT INTO TagMap VALUES (2,NULL,NULL,1,2,0);`,
        // Same "Reading" tag as A holding the SAME shared note, but at a different Position.
        `INSERT INTO Tag VALUES (3,1,'Reading');`,
        `INSERT INTO TagMap VALUES (3,NULL,NULL,2,3,5);`,
        `INSERT INTO PlaylistItemIndependentMediaMap VALUES (1,1,2000);`,
        `INSERT INTO PlaylistItemMarker VALUES (1,1,'MarkB',0,200,0);`,
        `INSERT INTO PlaylistItemMarkerBibleVerseMap VALUES (1,99);`,
        `INSERT INTO PlaylistItemAccuracy VALUES (1,'Accurate');`,
        `INSERT INTO LastModified VALUES ('2024-02-01T00:00:00Z');`,
        `INSERT INTO android_metadata VALUES ('en_US');`,
    ]);

    const blob = await window.mergeJWLibrary(A, B, { bookmarkResolver: 'chooseLeft', markingResolver: 'chooseLeft', noteResolver: 'chooseNewest', inputFieldResolver: 'chooseLeft' }, () => {});
    const buf = Buffer.from(await blob.arrayBuffer());
    const z = await JSZip.loadAsync(buf);
    const mdb = new SQL.Database(await z.file('userData.db').async('uint8array'));
    const q = s => { try { const r = mdb.exec(s); return r.length ? r[0].values : []; } catch (e) { return 'ERR:' + e.message; } };
    const count = t => { const r = q(`SELECT COUNT(*) FROM ${t}`); return Array.isArray(r) ? r[0][0] : r; };

    console.log('\n--- Backup packaging (no stale WAL, fresh timestamp) ---');
    // A stale WAL/SHM carried into the output makes JW Library replay old pages over the
    // merged db on import, silently reverting/dropping merged data. They must be dropped.
    assert(z.file('userData.db-wal') === null, 'stale userData.db-wal NOT carried into merged backup');
    assert(z.file('userData.db-shm') === null, 'stale userData.db-shm NOT carried into merged backup');
    // LastModified table must reflect the merge time, not the source backup's old value.
    const lm = q("SELECT LastModified FROM LastModified");
    const lmVal = Array.isArray(lm) && lm.length ? lm[0][0] : null;
    assert(lmVal && lmVal !== '2024-01-01T00:00:00Z' && lmVal !== '2024-02-01T00:00:00Z', 'LastModified table stamped to merge time');
    assert(lmVal && !isNaN(Date.parse(lmVal)) && Date.parse(lmVal) >= mergeStartMs - 2000, 'LastModified timestamp is recent (merge moment)');

    console.log('\n--- Tables present ---');
    const tables = q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map(r => r[0]);
    console.log(tables.join(', '));

    console.log('\n--- Notes ---');
    assert(count('Note') === 3, 'Note count = 3 (A-only, B-only, shared)');
    const shared = q("SELECT Content FROM Note WHERE Guid='guid-shared'");
    assert(Array.isArray(shared) && shared[0][0] === 'NEW text', 'shared note kept newest (B)');

    console.log('\n--- Playlists & media (Phase 1) ---');
    assert(tables.includes('PlaylistItem'), 'PlaylistItem table exists');
    assert(count('PlaylistItem') === 2, 'PlaylistItem count = 2 (union, no loss)');
    assert(count('IndependentMedia') === 3, 'IndependentMedia count = 3 (songA, songB, shared once)');
    assert(count('IndependentMedia') === q("SELECT COUNT(DISTINCT FilePath) FROM IndependentMedia")[0][0], 'IndependentMedia FilePath deduped (no UNIQUE(FilePath) collision)');
    assert(count('PlaylistItemMarker') === 2, 'PlaylistItemMarker count = 2');
    assert(count('PlaylistItemMarkerBibleVerseMap') === 2, 'BibleVerseMap count = 2');
    assert(count('PlaylistItemMarkerParagraphMap') === 1, 'ParagraphMap count = 1');
    assert(count('PlaylistItemIndependentMediaMap') === 2, 'MediaMap count = 2');
    assert(count('PlaylistItemLocationMap') === 1, 'LocationMap count = 1');

    // FK integrity: every map row points to an existing parent.
    assert(q("SELECT COUNT(*) FROM PlaylistItemMarker m WHERE NOT EXISTS (SELECT 1 FROM PlaylistItem p WHERE p.PlaylistItemId=m.PlaylistItemId)")[0][0] === 0, 'all markers point to a real PlaylistItem');
    assert(q("SELECT COUNT(*) FROM PlaylistItemMarkerBibleVerseMap b WHERE NOT EXISTS (SELECT 1 FROM PlaylistItemMarker m WHERE m.PlaylistItemMarkerId=b.PlaylistItemMarkerId)")[0][0] === 0, 'all BibleVerseMap point to a real marker');
    assert(q("SELECT COUNT(*) FROM PlaylistItemIndependentMediaMap x WHERE NOT EXISTS (SELECT 1 FROM IndependentMedia i WHERE i.IndependentMediaId=x.IndependentMediaId)")[0][0] === 0, 'all media maps point to real media');
    assert(q("SELECT COUNT(*) FROM TagMap t WHERE t.PlaylistItemId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM PlaylistItem p WHERE p.PlaylistItemId=t.PlaylistItemId)")[0][0] === 0, 'no orphaned playlist TagMap rows');

    console.log('\n--- TagMap UNIQUE(TagId, Position) ---');
    // The merge must not throw, and no two rows may share a (TagId, Position) pair.
    const favTag = q("SELECT TagId FROM Tag WHERE Type=1 AND Name='Favorites'");
    assert(Array.isArray(favTag) && favTag.length === 1, 'Favorites tag merged into a single TagId');
    if (Array.isArray(favTag) && favTag.length === 1) {
        const favId = favTag[0][0];
        const favPositions = q(`SELECT Position FROM TagMap WHERE TagId=${favId} ORDER BY Position`).map(r => r[0]);
        assert(favPositions.length === 2, 'both Favorites entries survived (no data loss)');
        assert(new Set(favPositions).size === favPositions.length, 'Favorites positions are unique (0,1)');
    }
    const dupes = q("SELECT COUNT(*) FROM (SELECT TagId, Position FROM TagMap GROUP BY TagId, Position HAVING COUNT(*) > 1)");
    assert(Array.isArray(dupes) && dupes[0][0] === 0, 'no duplicate (TagId, Position) pairs anywhere');

    // Same note in the same tag from both backups (different positions) must dedup to one row,
    // otherwise UNIQUE(TagId, NoteId) / UNIQUE(TagId, Position) would abort the merge.
    const readTag = q("SELECT TagId FROM Tag WHERE Type=1 AND Name='Reading'");
    assert(Array.isArray(readTag) && readTag.length === 1, 'Reading tag merged into a single TagId');
    if (Array.isArray(readTag) && readTag.length === 1) {
        const rid = readTag[0][0];
        assert(q(`SELECT COUNT(*) FROM TagMap WHERE TagId=${rid}`)[0][0] === 1, 'shared note tagged once in Reading (deduped by item, not position)');
    }
    const dupNote = q("SELECT COUNT(*) FROM (SELECT TagId, NoteId FROM TagMap WHERE NoteId IS NOT NULL GROUP BY TagId, NoteId HAVING COUNT(*) > 1)");
    assert(Array.isArray(dupNote) && dupNote[0][0] === 0, 'no duplicate (TagId, NoteId) pairs anywhere');
    const dupLoc = q("SELECT COUNT(*) FROM (SELECT TagId, LocationId FROM TagMap WHERE LocationId IS NOT NULL GROUP BY TagId, LocationId HAVING COUNT(*) > 1)");
    assert(Array.isArray(dupLoc) && dupLoc[0][0] === 0, 'no duplicate (TagId, LocationId) pairs anywhere');

    console.log('\n--- Metadata / reference tables (Phase 2) ---');
    assert(tables.includes('LastModified'), 'LastModified table exists');
    assert(count('LastModified') >= 1, 'LastModified has a row');
    assert(tables.includes('PlaylistItemAccuracy'), 'PlaylistItemAccuracy table exists');
    assert(count('PlaylistItemAccuracy') === 1, 'PlaylistItemAccuracy copied once (not duplicated)');
    assert(tables.includes('android_metadata'), 'android_metadata table exists');

    console.log('\n--- Indexes (Phase 2) ---');
    const idx = q("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").map(r => r[0]);
    assert(idx.includes('IX_Note_Guid'), 'unique index IX_Note_Guid recreated');

    mdb.close();

    // ---------------------------------------------------------------------------------------
    // Focused scenarios for the go-library-merger alignment + new resolver options.
    // ---------------------------------------------------------------------------------------
    async function runMerge(sqlsA, sqlsB, resolvers) {
        const rz = Object.assign({ bookmarkResolver: 'chooseLeft', markingResolver: 'chooseLeft', noteResolver: 'chooseNewest', inputFieldResolver: 'chooseLeft', favoritesResolver: 'merge' }, resolvers || {});
        const za = await build(SQL, sqlsA);
        const zb = await build(SQL, sqlsB);
        let err = null, db = null;
        try {
            const blob = await window.mergeJWLibrary(za, zb, rz, () => {});
            const buf = Buffer.from(await blob.arrayBuffer());
            const z = await JSZip.loadAsync(buf);
            db = new SQL.Database(await z.file('userData.db').async('uint8array'));
        } catch (e) { err = e; }
        const query = s => { try { const r = db.exec(s); return r.length ? r[0].values : []; } catch (e) { return 'ERR:' + e.message; } };
        return { db, err, q: query, one: s => { const r = query(s); return Array.isArray(r) && r.length ? r[0][0] : null; } };
    }

    console.log('\n--- Location dedup keeps Specialty/Edition distinct (go-library-merger) ---');
    {
        // Two locations identical except Specialty must NOT be merged into one.
        const a = [`INSERT INTO Location VALUES (1,10,NULL,NULL,NULL,0,'lff',0,0,NULL,'alpha',NULL);`];
        const b = [`INSERT INTO Location VALUES (1,10,NULL,NULL,NULL,0,'lff',0,0,NULL,'beta',NULL);`];
        const m = await runMerge(a, b);
        assert(!m.err, 'merge with differing Specialty succeeds');
        assert(m.one("SELECT COUNT(*) FROM Location") === 2, 'locations differing only by Specialty stay distinct (2 rows)');
    }

    console.log('\n--- Home Favorites resolver (merge / keep A / keep B) ---');
    {
        // Type-0 "Favorite" tag in both backups, each favoriting its own note.
        const a = [
            `INSERT INTO Note VALUES (1,'fav-A',NULL,NULL,'FA','ca','2024-01-01T00:00:00Z','2024-01-01T00:00:00Z',0,NULL);`,
            `INSERT INTO Tag VALUES (1,0,'Favorite');`,
            `INSERT INTO TagMap VALUES (1,NULL,NULL,1,1,0);`,
        ];
        const b = [
            `INSERT INTO Note VALUES (1,'fav-B',NULL,NULL,'FB','cb','2024-01-01T00:00:00Z','2024-01-01T00:00:00Z',0,NULL);`,
            `INSERT INTO Tag VALUES (1,0,'Favorite');`,
            `INSERT INTO TagMap VALUES (1,NULL,NULL,1,1,0);`,
        ];
        const favCount = m => m.one("SELECT COUNT(*) FROM TagMap tm JOIN Tag t ON t.TagId=tm.TagId WHERE t.Type=0");
        const hasGuid = (m, g) => m.one(`SELECT COUNT(*) FROM TagMap tm JOIN Tag t ON t.TagId=tm.TagId JOIN Note n ON n.NoteId=tm.NoteId WHERE t.Type=0 AND n.Guid='${g}'`) === 1;

        const mMerge = await runMerge(a, b, { favoritesResolver: 'merge' });
        assert(!mMerge.err && favCount(mMerge) === 2, 'favorites "merge": union of both lists (2 entries)');
        assert(hasGuid(mMerge, 'fav-A') && hasGuid(mMerge, 'fav-B'), 'favorites "merge": both A and B favorites present');

        const mLeft = await runMerge(a, b, { favoritesResolver: 'chooseLeft' });
        assert(!mLeft.err && favCount(mLeft) === 1 && hasGuid(mLeft, 'fav-A') && !hasGuid(mLeft, 'fav-B'), 'favorites "chooseLeft": only Backup A list kept');

        const mRight = await runMerge(a, b, { favoritesResolver: 'chooseRight' });
        assert(!mRight.err && favCount(mRight) === 1 && hasGuid(mRight, 'fav-B') && !hasGuid(mRight, 'fav-A'), 'favorites "chooseRight": only Backup B list kept');
    }

    console.log('\n--- Notes "keepBoth" resolver ---');
    {
        // Same Guid, different content -> both kept (one re-guided). Identical content -> one.
        const a = [`INSERT INTO Note VALUES (1,'note-x',NULL,NULL,'TA','content A','2024-01-01T00:00:00Z','2024-01-01T00:00:00Z',0,NULL);`,
                   `INSERT INTO Note VALUES (2,'note-same',NULL,NULL,'TS','same','2024-01-01T00:00:00Z','2024-01-01T00:00:00Z',0,NULL);`];
        const b = [`INSERT INTO Note VALUES (1,'note-x',NULL,NULL,'TB','content B','2024-02-01T00:00:00Z','2024-02-01T00:00:00Z',0,NULL);`,
                   `INSERT INTO Note VALUES (2,'note-same',NULL,NULL,'TS','same','2024-02-01T00:00:00Z','2024-02-01T00:00:00Z',0,NULL);`];
        const m = await runMerge(a, b, { noteResolver: 'keepBoth' });
        assert(!m.err, 'keepBoth merge succeeds');
        assert(m.one("SELECT COUNT(*) FROM Note") === 3, 'keepBoth: diverging note duplicated, identical note deduped (3 total)');
        assert(m.one("SELECT COUNT(*) FROM Note WHERE Content='content A'") === 1 && m.one("SELECT COUNT(*) FROM Note WHERE Content='content B'") === 1, 'keepBoth: both versions of the diverging note survive');
        assert(m.one("SELECT COUNT(DISTINCT Guid) FROM Note") === m.one("SELECT COUNT(*) FROM Note"), 'keepBoth: every kept note has a unique Guid');

        const mNewest = await runMerge(a, b, { noteResolver: 'chooseNewest' });
        assert(mNewest.one("SELECT COUNT(*) FROM Note") === 2 && mNewest.one("SELECT COUNT(*) FROM Note WHERE Content='content B'") === 1, 'chooseNewest still overwrites (2 total, keeps newest)');
    }

    console.log('\n--- UserMark UNIQUE(UserMarkGuid) safety ---');
    {
        // Same UserMarkGuid on both sides but different block ranges: composite dedup keeps both,
        // which would violate UNIQUE(UserMarkGuid) without the post-merge GUID cleanup.
        const a = [
            `INSERT INTO Location VALUES (1,1,1,NULL,NULL,0,'nwtsty',0,0,NULL,NULL,NULL);`,
            `INSERT INTO UserMark VALUES (1,1,1,0,'mark-guid',1);`,
            `INSERT INTO BlockRange VALUES (1,1,1,0,5,1);`,
        ];
        const b = [
            `INSERT INTO Location VALUES (1,1,1,NULL,NULL,0,'nwtsty',0,0,NULL,NULL,NULL);`,
            `INSERT INTO UserMark VALUES (1,1,1,0,'mark-guid',1);`,
            `INSERT INTO BlockRange VALUES (1,1,1,0,12,1);`,
        ];
        const m = await runMerge(a, b);
        assert(!m.err, 'merge with same UserMarkGuid but different block ranges succeeds (no UNIQUE violation)');
        assert(m.one("SELECT COUNT(*) FROM UserMark WHERE UserMarkGuid='mark-guid'") === 1, 'duplicate UserMarkGuid collapsed to a single mark');
    }

    console.log('\n--- nwt -> nwtsty Bible edition migration (go-library-merger) ---');
    {
        // Same verse highlight (shared UserMarkGuid) on Standard edition (nwt) in A and Study
        // edition (nwtsty) in B. A's simple Bible location is migrated so the two collapse.
        const a = [
            `INSERT INTO Location VALUES (1,1,1,NULL,NULL,0,'nwt',0,0,NULL,NULL,NULL);`,
            `INSERT INTO UserMark VALUES (1,1,1,0,'verse-guid',1);`,
            `INSERT INTO BlockRange VALUES (1,2,1,0,5,1);`,
        ];
        const b = [
            `INSERT INTO Location VALUES (1,1,1,NULL,NULL,0,'nwtsty',0,0,NULL,NULL,NULL);`,
            `INSERT INTO UserMark VALUES (1,1,1,0,'verse-guid',1);`,
            `INSERT INTO BlockRange VALUES (1,2,1,0,5,1);`,
        ];
        const m = await runMerge(a, b);
        assert(!m.err, 'nwt/nwtsty merge succeeds');
        assert(m.one("SELECT COUNT(*) FROM Location") === 1, 'nwt Bible location migrated & merged into the nwtsty one (1 location)');
        assert(m.one("SELECT KeySymbol FROM Location") === 'nwtsty', 'surviving Bible location is the study edition (nwtsty)');
        assert(m.one("SELECT COUNT(*) FROM UserMark WHERE UserMarkGuid='verse-guid'") === 1, 'the shared verse highlight is kept once');
    }

    console.log(`\n=== ${pass} passed, ${fail} failed ===`);
    process.exit(fail ? 1 : 0);
})();
