// Create simple dummy .jwlibrary
const JSZip = require('jszip');
const fs = require('fs');
const initSqlJs = require('sql.js');

async function createMockDb(filename, val) {
    const SQL = await initSqlJs();
    const db = new SQL.Database();

    // Create minimal schema for testing
    db.run("CREATE TABLE Location (LocationId INTEGER PRIMARY KEY, BookNumber INTEGER, ChapterNumber INTEGER, DocumentId INTEGER, Track INTEGER, IssueTagNumber INTEGER, KeySymbol TEXT, MepsLanguage INTEGER, Type INTEGER, Title TEXT);");
    db.run(`INSERT INTO Location (LocationId, BookNumber, Title) VALUES (1, ${val}, 'Test ${val}');`);

    db.run("CREATE TABLE Bookmark (BookmarkId INTEGER PRIMARY KEY, LocationId INTEGER, PublicationLocationId INTEGER, Slot INTEGER, Title TEXT, Snippet TEXT, BlockType INTEGER, BlockIdentifier INTEGER);");
    db.run(`INSERT INTO Bookmark (BookmarkId, LocationId, PublicationLocationId, Slot, Title) VALUES (1, 1, 1, ${val}, 'BM ${val}');`);

    // Add remaining required tables empty
    const tb = ["Tag", "UserMark", "BlockRange", "Note", "TagMap", "InputField"];
    for (let t of tb) {
        db.run(`CREATE TABLE ${t} (DummyId INTEGER PRIMARY KEY);`);
    }

    const dbData = db.export();

    const zip = new JSZip();
    zip.file("userData.db", dbData);
    zip.file("manifest.json", JSON.stringify({}));

    zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true })
        .pipe(fs.createWriteStream(filename))
        .on('finish', function () {
            console.log(filename + " written.");
        });
}

createMockDb('left.jwlibrary', 10);
createMockDb('right.jwlibrary', 20);
