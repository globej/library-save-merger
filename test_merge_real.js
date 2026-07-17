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
  CREATE TABLE Location (LocationId INTEGER PRIMARY KEY, BookNumber INT, ChapterNumber INT, DocumentId INT, Track INT, IssueTagNumber INT, KeySymbol TEXT, MepsLanguage INT, Type INT, Title TEXT);
  CREATE TABLE UserMark (UserMarkId INTEGER PRIMARY KEY, ColorIndex INT, LocationId INT, StyleIndex INT, UserMarkGuid TEXT, Version INT);
  CREATE TABLE BlockRange (BlockRangeId INTEGER PRIMARY KEY, BlockType INT, Identifier INT, StartToken INT, EndToken INT, UserMarkId INT);
  CREATE TABLE Bookmark (BookmarkId INTEGER PRIMARY KEY, LocationId INT, PublicationLocationId INT, Slot INT, Title TEXT, Snippet TEXT, BlockType INT, BlockIdentifier INT);
  CREATE TABLE Note (NoteId INTEGER PRIMARY KEY, Guid TEXT, UserMarkId INT, LocationId INT, Title TEXT, Content TEXT, LastModified TEXT, Created TEXT, BlockType INT, BlockIdentifier INT);
  CREATE TABLE Tag (TagId INTEGER PRIMARY KEY, Type INT, Name TEXT);
  CREATE TABLE TagMap (TagMapId INTEGER PRIMARY KEY, PlaylistItemId INT, LocationId INT, NoteId INT, TagId INT, Position INT, CONSTRAINT UQ_TagMap UNIQUE (TagId, Position));
  CREATE TABLE InputField (LocationId INT, TextTag TEXT, Value TEXT, PRIMARY KEY (LocationId, TextTag));
  CREATE TABLE IndependentMedia (IndependentMediaId INTEGER PRIMARY KEY, OriginalFilename TEXT, FilePath TEXT, MimeType TEXT, Hash TEXT);
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

async function build(SQL, sqls) {
    const db = new SQL.Database();
    db.run(SCHEMA);
    for (const s of sqls) db.run(s);
    const z = new JSZip();
    z.file('userData.db', db.export());
    z.file('manifest.json', JSON.stringify({ name: 'b', creationDate: '2024-01-01', version: 1, type: 0, userDataBackup: { lastModifiedDate: '2024-01-01T00:00:00Z', hash: 'x', deviceName: 'd', databaseName: 'userData.db', schemaVersion: 14 } }));
    db.close();
    return z.generateAsync({ type: 'nodebuffer' });
}

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ FAIL: ' + msg); } }

(async () => {
    const SQL = await initSqlJs();

    const A = await build(SQL, [
        `INSERT INTO Location VALUES (1,1,NULL,NULL,NULL,NULL,'nwtsty',0,0,NULL);`,
        `INSERT INTO Note VALUES (1,'guid-A-only',NULL,1,'NoteA','content A','2024-01-01T00:00:00Z','2024-01-01T00:00:00Z',NULL,NULL);`,
        `INSERT INTO Note VALUES (2,'guid-shared',NULL,1,'Shared','old text','2024-01-01T00:00:00Z','2024-01-01T00:00:00Z',NULL,NULL);`,
        `INSERT INTO Tag VALUES (1,1,'Study');`,
        `INSERT INTO TagMap VALUES (1,NULL,NULL,1,1,0);`,
        // Shared "Favorites" tag (same Type+Name in both backups -> merged into one TagId).
        // A tags its own note here at Position 0; B tags a different note at Position 0 too,
        // which would collide on UNIQUE(TagId, Position) after the tags merge.
        `INSERT INTO Tag VALUES (3,1,'Favorites');`,
        `INSERT INTO TagMap VALUES (3,NULL,NULL,1,3,0);`,
        // A playlist: Tag(Type=2) + 1 item + media + location + marker
        `INSERT INTO Tag VALUES (2,2,'My Playlist');`,
        `INSERT INTO IndependentMedia VALUES (1,'songA.mp3','/a','audio/mpeg','hashA');`,
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
    ]);

    const B = await build(SQL, [
        `INSERT INTO Location VALUES (1,1,NULL,NULL,NULL,NULL,'nwtsty',0,0,NULL);`,
        `INSERT INTO Note VALUES (1,'guid-B-only',NULL,1,'NoteB','content B','2024-02-01T00:00:00Z','2024-02-01T00:00:00Z',NULL,NULL);`,
        `INSERT INTO Note VALUES (2,'guid-shared',NULL,1,'Shared','NEW text','2024-03-01T00:00:00Z','2024-01-01T00:00:00Z',NULL,NULL);`,
        // B playlist: different item + media + marker
        `INSERT INTO Tag VALUES (1,2,'B Playlist');`,
        `INSERT INTO IndependentMedia VALUES (1,'songB.mp3','/b','audio/mpeg','hashB');`,
        `INSERT INTO PlaylistItem VALUES (1,'Item B',0,0,1,0,NULL);`,
        `INSERT INTO TagMap VALUES (1,1,NULL,NULL,1,0);`,
        // Same "Favorites" tag as A; its note also sits at Position 0 (collision source).
        `INSERT INTO Tag VALUES (2,1,'Favorites');`,
        `INSERT INTO TagMap VALUES (2,NULL,NULL,1,2,0);`,
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
    assert(count('IndependentMedia') === 2, 'IndependentMedia count = 2');
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
    console.log(`\n=== ${pass} passed, ${fail} failed ===`);
    process.exit(fail ? 1 : 0);
})();
