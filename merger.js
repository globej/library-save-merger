(function () {
    // Helper to get property case-insensitively
    const val = (row, col) => {
        if (!row || !col) return undefined;
        const lower = String(col).toLowerCase();
        for (const k in row) {
            if (String(k).toLowerCase() === lower) return row[k];
        }
        return undefined;
    };

    // Helper to set property case-insensitively
    const setVal = (row, col, value) => {
        if (!row || !col) return;
        const lower = String(col).toLowerCase();
        for (const k in row) {
            if (String(k).toLowerCase() === lower) {
                row[k] = value;
                return;
            }
        }
        row[col] = value; // fallback
    };

    // Generate a fresh lowercase UUID-v4 (matches JW Library's note/mark GUID format).
    const newGuid = () => {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    };

    // Utility to get a row's values as an object based on columns
    const rowToObject = (columns, values) => {
        const obj = {};
        for (let i = 0; i < columns.length; i++) {
            obj[columns[i]] = values[i];
        }
        return obj;
    };

    // Maps foreign keys using the changes object
    function updateForeignKeys(rows, fkColumn, changesDict) {
        for (let row of rows) {
            let oldId = val(row, fkColumn);
            if (oldId !== null && oldId !== undefined && changesDict[oldId] !== undefined) {
                setVal(row, fkColumn, changesDict[oldId]);
            }
        }
    }

    // Resolves conflict between two rows
    function resolveConflict(leftRow, rightRow, resolver, tableName) {
        if (resolver === 'chooseLeft') return leftRow;
        if (resolver === 'chooseRight') return rightRow;
        if (resolver === 'chooseNewest') {
            if (tableName === 'Note') {
                const lTime = new Date(val(leftRow, 'LastModified') || val(leftRow, 'Created') || 0).getTime();
                const rTime = new Date(val(rightRow, 'LastModified') || val(rightRow, 'Created') || 0).getTime();
                return lTime >= rTime ? leftRow : rightRow;
            }
        }
        return leftRow; // Default fallback
    }

    // Generic merge table logic
    function mergeTable(leftRows, rightRows, pkColumn, uniqueKeyFn, resolver, tableName) {
        let duplicateCheck = {};

        let changesLeft = {};
        let changesRight = {};

        // Process Left
        for (let row of leftRows) {
            let uk = uniqueKeyFn(row);
            duplicateCheck[uk] = { side: 'left', row: row };
        }

        // Process Right
        for (let row of rightRows) {
            let uk = uniqueKeyFn(row);
            if (duplicateCheck[uk]) {
                // Conflict
                let leftRow = duplicateCheck[uk].row;
                duplicateCheck[uk].row = resolveConflict(leftRow, row, resolver, tableName);
                duplicateCheck[uk].side = 'resolved';

                // Track discarded so we know both old IDs map to the winning row's future PK
                duplicateCheck[uk].leftOldId = val(leftRow, pkColumn);
                duplicateCheck[uk].rightOldId = val(row, pkColumn);
            } else {
                duplicateCheck[uk] = { side: 'right', row: row };
                duplicateCheck[uk].rightOldId = val(row, pkColumn);
            }
        }

        // Generate new IDs
        const mergedRows = [];
        let newId = 1;

        // Ensure consistent sorting (Go sorted by UniqueKey then ID)
        const keys = Object.keys(duplicateCheck).sort();

        for (const uk of keys) {
            const item = duplicateCheck[uk];
            const rowWrapper = { ...item.row }; // shallow copy

            if (pkColumn) {
                // Assign new PK
                const finalId = newId++;
                const currentLeftPk = val(item.row, pkColumn);

                if (item.side === 'left') {
                    changesLeft[currentLeftPk] = finalId;
                } else if (item.side === 'right') {
                    changesRight[currentLeftPk] = finalId;
                } else if (item.side === 'resolved') {
                    changesLeft[item.leftOldId] = finalId;
                    changesRight[item.rightOldId] = finalId;
                }

                setVal(rowWrapper, pkColumn, finalId);
            }

            mergedRows.push(rowWrapper);
        }

        return {
            rows: mergedRows,
            changesLeft: changesLeft,
            changesRight: changesRight
        };
    }

    // Read all rows from a table
    function extractTable(db, tableName) {
        try {
            let res = db.exec(`SELECT * FROM ${tableName}`);
            if (res.length === 0) return { columns: [], rows: [] };

            let columns = res[0].columns;
            let rows = res[0].values.map(v => rowToObject(columns, v));
            return { columns, rows };
        } catch (e) {
            console.warn(`Table ${tableName} may not exist in this backup version.`, e);
            return { columns: [], rows: [] };
        }
    }

    // Create table schema from source db
    function cloneTableSchema(sourceDb, targetDb, tableName) {
        let res = sourceDb.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${tableName}'`);
        if (res.length > 0 && res[0].values.length > 0) {
            let createSql = res[0].values[0][0];
            targetDb.run(createSql);
            return true;
        }
        return false;
    }

    // Insert rows back into target db
    const insertTable = (targetDb, tableName, columns, rows) => {
        if (rows.length === 0) return;

        const colsStr = columns.map(c => `"${c}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        const sql = `INSERT INTO "${tableName}" (${colsStr}) VALUES (${placeholders})`;

        targetDb.exec("BEGIN TRANSACTION;");
        const stmt = targetDb.prepare(sql);
        for (const row of rows) {
            // When inserting, we MUST pull values using exact match with columns
            const values = columns.map(c => val(row, c));
            stmt.run(values);
        }
        stmt.free();
        targetDb.exec("COMMIT;");
    };

    // List all user tables in a database (excludes internal sqlite_* tables)
    function listTables(db) {
        try {
            let res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
            return res.length > 0 ? res[0].values.map(v => v[0]) : [];
        } catch (e) {
            return [];
        }
    }

    // Check if a table already exists in a database
    function tableExists(db, name) {
        try {
            let res = db.exec(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='${name}'`);
            return res.length > 0 && res[0].values.length > 0;
        } catch (e) {
            return false;
        }
    }

    // Copy every index or trigger definition from source to target. Run AFTER data is
    // loaded so unique indexes / triggers never interfere with our bulk inserts.
    function copySchemaObjects(sourceDb, targetDb, type) {
        let res;
        try {
            res = sourceDb.exec(`SELECT sql FROM sqlite_master WHERE type='${type}' AND sql IS NOT NULL`);
        } catch (e) {
            return;
        }
        if (res.length === 0) return;
        for (const [sql] of res[0].values) {
            try {
                targetDb.run(sql);
            } catch (e) {
                console.warn(`Could not recreate ${type}: ${sql}`, e);
            }
        }
    }

    // Union two sets of rows (no dedup): concatenate them and assign fresh primary keys,
    // returning the change maps so foreign keys can be remapped. Used for tables that have
    // no stable unique key (playlists/media) where dropping a row would lose user data.
    function unionTable(leftRows, rightRows, pkColumn) {
        const mergedRows = [];
        const changesLeft = {};
        const changesRight = {};
        let newId = 1;

        for (const row of leftRows) {
            const r = { ...row };
            if (pkColumn) {
                const oldId = val(row, pkColumn);
                const finalId = newId++;
                changesLeft[oldId] = finalId;
                setVal(r, pkColumn, finalId);
            }
            mergedRows.push(r);
        }
        for (const row of rightRows) {
            const r = { ...row };
            if (pkColumn) {
                const oldId = val(row, pkColumn);
                const finalId = newId++;
                changesRight[oldId] = finalId;
                setVal(r, pkColumn, finalId);
            }
            mergedRows.push(r);
        }

        return { rows: mergedRows, changesLeft, changesRight };
    }

    // TagMap has a UNIQUE(TagId, Position) constraint: Position is the ordering of items
    // inside a tag. When identical tags from both backups collapse into a single TagId,
    // items from each side keep their original positions (0, 1, 2...), producing duplicate
    // (TagId, Position) pairs. Exact-duplicate rows were already dropped by the merge, so the
    // survivors are genuinely distinct items that must each get a unique slot. Renumber the
    // Position of every row within a TagId to a contiguous 0-based sequence, preserving the
    // existing relative order (stable sort on the original Position).
    function reindexTagMapPositions(rows) {
        const groups = {};
        rows.forEach((row, idx) => {
            const tagId = val(row, 'TagId');
            const key = tagId === null || tagId === undefined ? '' : String(tagId);
            (groups[key] || (groups[key] = [])).push({ row, idx });
        });

        for (const key in groups) {
            const items = groups[key];
            items.sort((a, b) => {
                const pa = Number(val(a.row, 'Position'));
                const pb = Number(val(b.row, 'Position'));
                if (pa !== pb) return pa - pb;
                return a.idx - b.idx; // stable tiebreak keeps deterministic order
            });
            items.forEach((item, position) => setVal(item.row, 'Position', position));
        }

        return rows;
    }

    // Harmonise the Bible edition across the two backups (Standard "nwt" <-> Study "nwtsty").
    // If a highlight (identified by a shared UserMarkGuid) sits on an "nwt" location in one
    // backup and an "nwtsty" location in the other, the lagging "nwt" side is migrated: its
    // *simple* Bible book locations (KeySymbol "nwt", no DocumentId and no Track) get their
    // KeySymbol rewritten to "nwtsty" in place, so the subsequent Location merge deduplicates
    // them against the study-edition side instead of leaving verse duplicates behind.
    // Mirrors go-library-merger's needsNwtstyMigration / moveToNwtsty.
    function migrateBibleEdition(L, R) {
        const keySymByLoc = (rows) => {
            const m = {};
            for (const loc of rows) m[String(val(loc, 'LocationId'))] = val(loc, 'KeySymbol');
            return m;
        };
        const guidKeySym = (userMarks, locKey) => {
            const m = {};
            for (const um of userMarks) {
                m[val(um, 'UserMarkGuid')] = locKey[String(val(um, 'LocationId'))];
            }
            return m;
        };

        const lLocKey = keySymByLoc(L.Location);
        const rLocKey = keySymByLoc(R.Location);
        const lGuid = guidKeySym(L.UserMark, lLocKey);
        const rGuid = guidKeySym(R.UserMark, rLocKey);

        let leftNeedsMigration = false;
        let rightNeedsMigration = false;
        for (const guid in lGuid) {
            if (!(guid in rGuid)) continue;
            const l = lGuid[guid], r = rGuid[guid];
            if (l === 'nwt' && r === 'nwtsty') leftNeedsMigration = true;
            else if (l === 'nwtsty' && r === 'nwt') rightNeedsMigration = true;
        }

        const moveToNwtsty = (rows) => {
            for (const loc of rows) {
                if (val(loc, 'KeySymbol') !== 'nwt') continue;
                const docId = val(loc, 'DocumentId');
                const track = val(loc, 'Track');
                const hasDoc = docId !== null && docId !== undefined;
                const hasTrack = track !== null && track !== undefined;
                if (hasDoc || hasTrack) continue; // only simple Bible book locations
                setVal(loc, 'KeySymbol', 'nwtsty');
            }
        };

        if (leftNeedsMigration) moveToNwtsty(L.Location);
        if (rightNeedsMigration) moveToNwtsty(R.Location);
    }

    // Main Merge logic
    window.mergeJWLibrary = async function (leftFile, rightFile, resolvers, statusCallback) {
        statusCallback("Loading JSZip and WebAssembly...");
        const sqlPromise = initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        });

        const jszipLeft = new JSZip();
        const jszipRight = new JSZip();

        const [SQL, leftZip, rightZip] = await Promise.all([
            sqlPromise,
            jszipLeft.loadAsync(leftFile),
            jszipRight.loadAsync(rightFile)
        ]);

        statusCallback("Extracting databases...");
        const leftDbData = await leftZip.file("userData.db").async("uint8array");
        const rightDbData = await rightZip.file("userData.db").async("uint8array");

        const leftDb = new SQL.Database(leftDbData);
        const rightDb = new SQL.Database(rightDbData);
        const mergedDb = new SQL.Database(); // empty db

        // Read schemaVersion from source manifest (fallback to 8)
        let schemaVersion = 8;
        try {
            const manifestFile = leftZip.file("manifest.json") || rightZip.file("manifest.json");
            if (manifestFile) {
                const manifestText = await manifestFile.async("string");
                const manifest = JSON.parse(manifestText);
                schemaVersion = (manifest.userDataBackup && manifest.userDataBackup.schemaVersion) || 8;
            }
        } catch (e) {
            console.warn("Could not read schemaVersion from manifest, using default.", e);
        }

        try {

            statusCallback("Preparing tables schema...");

            // The 8 "core" tables, merged with conflict resolution / GUID dedup.
            const coreTables = [
                "Location", "Tag", "UserMark", "BlockRange", "Bookmark",
                "Note", "TagMap", "InputField"
            ];

            // Playlist / media tables. They have no stable GUID, so we UNION them
            // (concatenate from both backups with fresh primary keys) and remap their
            // foreign keys, instead of trying to dedup. This guarantees no playlist,
            // custom media or marker data is lost during the merge.
            const playlistTables = [
                "IndependentMedia", "PlaylistItem", "PlaylistItemMarker",
                "PlaylistItemMarkerBibleVerseMap", "PlaylistItemMarkerParagraphMap",
                "PlaylistItemIndependentMediaMap", "PlaylistItemLocationMap"
            ];

            // Everything we actively merge; all other tables are copied verbatim.
            const managedTables = new Set([...coreTables, ...playlistTables]);

            // Recreate the FULL schema (every table) from the source so nothing is dropped.
            // Indexes and triggers are added later, AFTER data is loaded.
            const leftTables = listTables(leftDb);
            for (let t of leftTables) cloneTableSchema(leftDb, mergedDb, t);
            for (let t of listTables(rightDb)) {
                if (!tableExists(mergedDb, t)) cloneTableSchema(rightDb, mergedDb, t);
            }

            // Helper to get unique key string safely handling nulls
            const uk = (...args) => args.map(a => a === null || a === undefined ? '' : String(a)).join('_');

            // Extract every managed table from both databases.
            let L = {}, R = {}, Cols = {};
            for (let t of managedTables) {
                let exL = extractTable(leftDb, t);
                let exR = extractTable(rightDb, t);
                L[t] = exL.rows;
                R[t] = exR.rows;
                Cols[t] = exL.columns.length > 0 ? exL.columns : exR.columns;
            }

            // Bible edition harmonisation (nwt <-> nwtsty). One device may have migrated its
            // Bible from the Standard edition (KeySymbol "nwt") to the Study edition ("nwtsty")
            // while the other has not. The same verse highlight then lives on two locations that
            // differ only by KeySymbol, so it would not dedup and would appear twice. Mirroring
            // go-library-merger's PrepareDatabase, we detect the asymmetry via highlights sharing
            // a UserMarkGuid across backups and migrate the lagging "nwt" side's *simple* Bible
            // book locations (no DocumentId, no Track) to "nwtsty" so they merge naturally.
            migrateBibleEdition(L, R);

            statusCallback("Merging Locations...");
            let locMerge = mergeTable(L.Location, R.Location, "LocationId",
                r => uk(val(r, 'BookNumber'), val(r, 'ChapterNumber'), val(r, 'DocumentId'), val(r, 'Track'), val(r, 'IssueTagNumber'), val(r, 'KeySymbol'), val(r, 'MepsLanguage'), val(r, 'Type'), val(r, 'Specialty'), val(r, 'Edition')),
                'chooseLeft', 'Location');

            updateForeignKeys(L.Bookmark, "LocationId", locMerge.changesLeft);
            updateForeignKeys(R.Bookmark, "LocationId", locMerge.changesRight);
            updateForeignKeys(L.Bookmark, "PublicationLocationId", locMerge.changesLeft);
            updateForeignKeys(R.Bookmark, "PublicationLocationId", locMerge.changesRight);

            updateForeignKeys(L.InputField, "LocationId", locMerge.changesLeft);
            updateForeignKeys(R.InputField, "LocationId", locMerge.changesRight);

            updateForeignKeys(L.Note, "LocationId", locMerge.changesLeft);
            updateForeignKeys(R.Note, "LocationId", locMerge.changesRight);

            updateForeignKeys(L.TagMap, "LocationId", locMerge.changesLeft);
            updateForeignKeys(R.TagMap, "LocationId", locMerge.changesRight);

            updateForeignKeys(L.UserMark, "LocationId", locMerge.changesLeft);
            updateForeignKeys(R.UserMark, "LocationId", locMerge.changesRight);

            statusCallback("Merging Tags...");
            let tagMerge = mergeTable(L.Tag, R.Tag, "TagId",
                r => uk(val(r, 'Type'), val(r, 'Name')),
                'chooseLeft', 'Tag');

            updateForeignKeys(L.TagMap, "TagId", tagMerge.changesLeft);
            updateForeignKeys(R.TagMap, "TagId", tagMerge.changesRight);

            // Home-screen favorites live in the single Tag of Type 0 ("Favorite"). Because both
            // backups have that tag (same Type+Name), it collapses into one TagId and the two
            // favorite lists get unioned by default. When the user asks to keep one side's list
            // instead, drop the other side's favorite TagMap rows now (TagIds are already remapped
            // to the merged id, so a Type-0 lookup on tagMerge.rows identifies them on both sides).
            const favResolver = resolvers.favoritesResolver || 'merge';
            if (favResolver === 'chooseLeft' || favResolver === 'chooseRight') {
                const favTagIds = new Set(
                    tagMerge.rows.filter(t => Number(val(t, 'Type')) === 0).map(t => val(t, 'TagId'))
                );
                if (favTagIds.size) {
                    if (favResolver === 'chooseLeft') {
                        R.TagMap = R.TagMap.filter(r => !favTagIds.has(val(r, 'TagId')));
                    } else {
                        L.TagMap = L.TagMap.filter(r => !favTagIds.has(val(r, 'TagId')));
                    }
                }
            }

            statusCallback("Merging UserMarks & BlockRanges...");

            function groupBRs(brs, side) {
                let map = {};
                for (let br of brs) {
                    let umId = val(br, 'UserMarkId');
                    if (!map[umId]) map[umId] = [];
                    br._side = side;
                    map[umId].push(br);
                }
                return map;
            }
            let leftBRMap = groupBRs(L.BlockRange, 'left');
            let rightBRMap = groupBRs(R.BlockRange, 'right');

            for (let um of L.UserMark) {
                um._side = 'left';
                um._brs = leftBRMap[val(um, 'UserMarkId')] || [];
            }
            for (let um of R.UserMark) {
                um._side = 'right';
                um._brs = rightBRMap[val(um, 'UserMarkId')] || [];
            }

            function getUMBRKey(um) {
                let umKey = uk(val(um, 'UserMarkGuid'));
                let brKeys = um._brs.map(br => uk(val(br, 'BlockType'), val(br, 'Identifier'), val(br, 'StartToken'), val(br, 'EndToken'))).sort();
                return umKey + "_" + brKeys.join("_");
            }

            let duplicateCheckUM = {};
            let changesLeftUM = {};
            let changesRightUM = {};

            for (let um of L.UserMark) {
                let key = getUMBRKey(um);
                duplicateCheckUM[key] = { side: 'left', um: um };
            }

            for (let um of R.UserMark) {
                let key = getUMBRKey(um);
                if (duplicateCheckUM[key]) {
                    let leftUM = duplicateCheckUM[key].um;
                    let chosenUM = resolveConflict(leftUM, um, resolvers.markingResolver, 'UserMark');
                    duplicateCheckUM[key].um = chosenUM;
                    duplicateCheckUM[key].side = 'resolved';
                    duplicateCheckUM[key].leftOldId = val(leftUM, 'UserMarkId');
                    duplicateCheckUM[key].rightOldId = val(um, 'UserMarkId');
                } else {
                    duplicateCheckUM[key] = { side: 'right', um: um };
                    duplicateCheckUM[key].rightOldId = val(um, 'UserMarkId');
                }
            }

            let mergedUMs = [];
            let mergedBRs = [];
            let newUmId = 1;
            let newBrId = 1;

            let umKeys = Object.keys(duplicateCheckUM).sort();

            for (let k of umKeys) {
                let item = duplicateCheckUM[k];
                let um = Object.assign({}, item.um);
                let finalUmId = newUmId++;
                let currentLeftPk = val(item.um, 'UserMarkId');

                if (item.side === 'left') {
                    changesLeftUM[currentLeftPk] = finalUmId;
                } else if (item.side === 'right') {
                    changesRightUM[currentLeftPk] = finalUmId;
                } else if (item.side === 'resolved') {
                    changesLeftUM[item.leftOldId] = finalUmId;
                    changesRightUM[item.rightOldId] = finalUmId;
                }

                setVal(um, 'UserMarkId', finalUmId);

                let brsToInsert = item.um._brs;
                for (let br of brsToInsert) {
                    let finalBr = Object.assign({}, br);
                    setVal(finalBr, 'UserMarkId', finalUmId);
                    setVal(finalBr, 'BlockRangeId', newBrId++);
                    delete finalBr._side;
                    mergedBRs.push(finalBr);
                }

                delete um._brs;
                delete um._side;
                mergedUMs.push(um);
            }

            let umMerge = {
                rows: mergedUMs,
                changesLeft: changesLeftUM,
                changesRight: changesRightUM
            };

            let brMerge = {
                rows: mergedBRs
            };

            updateForeignKeys(L.Note, "UserMarkId", umMerge.changesLeft);
            updateForeignKeys(R.Note, "UserMarkId", umMerge.changesRight);

            // Post-merge safety: UserMark enforces UNIQUE(UserMarkGuid), yet marks are deduped on a
            // composite key (guid + block-range signature), so the same guid can survive twice — a
            // highlight extended on one device, or an nwt/nwtsty Bible duplicate. Collapse every
            // duplicated guid to a single UserMark (preferring the study-edition "nwtsty" location),
            // drop the losers' BlockRanges, and repoint notes onto the kept mark. Without this the
            // final INSERT would abort on the UNIQUE(UserMarkGuid) constraint. Mirrors
            // go-library-merger's detectDuplicateUserMarks / tryDuplicateUserMarkCleanup.
            {
                const locKeySym = {};
                for (const loc of locMerge.rows) locKeySym[String(val(loc, 'LocationId'))] = val(loc, 'KeySymbol');

                const byGuid = {};
                for (const um of umMerge.rows) {
                    const g = val(um, 'UserMarkGuid');
                    (byGuid[g] || (byGuid[g] = [])).push(um);
                }

                const remap = {}; // removed UserMarkId -> kept UserMarkId
                const removedIds = new Set();
                for (const g in byGuid) {
                    const group = byGuid[g];
                    if (group.length < 2) continue;
                    const keeper = group.find(um => locKeySym[String(val(um, 'LocationId'))] === 'nwtsty') || group[0];
                    const keeperId = val(keeper, 'UserMarkId');
                    for (const um of group) {
                        if (um === keeper) continue;
                        const rid = val(um, 'UserMarkId');
                        remap[rid] = keeperId;
                        removedIds.add(rid);
                    }
                }

                if (removedIds.size) {
                    umMerge.rows = umMerge.rows.filter(um => !removedIds.has(val(um, 'UserMarkId')));
                    brMerge.rows = brMerge.rows.filter(br => !removedIds.has(val(br, 'UserMarkId')));
                    updateForeignKeys(L.Note, "UserMarkId", remap);
                    updateForeignKeys(R.Note, "UserMarkId", remap);
                }
            }

            statusCallback("Merging Bookmarks...");
            let bmMerge = mergeTable(L.Bookmark, R.Bookmark, "BookmarkId",
                r => uk(val(r, 'PublicationLocationId'), val(r, 'Slot')),
                resolvers.bookmarkResolver, 'Bookmark');

            statusCallback("Merging Notes...");
            // "keepBoth": instead of overwriting a note edited differently on both devices, keep
            // both versions. Notes dedup on Guid, so we hand the right-side copy of any diverging
            // shared note a fresh Guid; it then survives the merge as a distinct note (its own new
            // NoteId, remapped onto TagMap via changesRight). Notes with identical content still
            // collapse to one. Guid stays UNIQUE and (TagId, NoteId) stays satisfied.
            let noteResolver = resolvers.noteResolver;
            if (noteResolver === 'keepBoth') {
                const leftByGuid = {};
                for (const n of L.Note) leftByGuid[val(n, 'Guid')] = n;
                for (const n of R.Note) {
                    const ln = leftByGuid[val(n, 'Guid')];
                    if (ln && (val(ln, 'Content') !== val(n, 'Content') || val(ln, 'Title') !== val(n, 'Title'))) {
                        setVal(n, 'Guid', newGuid());
                    }
                }
                noteResolver = 'chooseNewest'; // only identical-content notes can still collide
            }
            let noteMerge = mergeTable(L.Note, R.Note, "NoteId",
                r => uk(val(r, 'Guid')),
                noteResolver, 'Note');

            updateForeignKeys(L.TagMap, "NoteId", noteMerge.changesLeft);
            updateForeignKeys(R.TagMap, "NoteId", noteMerge.changesRight);

            statusCallback("Merging Playlists & media...");
            // IndependentMedia has UNIQUE(FilePath): the same media file (identical FilePath)
            // can exist in both backups, so we must merge by FilePath rather than blindly
            // concatenate — a plain union would insert the shared FilePath twice and abort.
            // FilePath is kept unchanged, so PlaylistItem.ThumbnailFilePath (an FK on FilePath)
            // stays valid; only IndependentMediaId is reassigned and remapped below.
            let imMerge = mergeTable(L.IndependentMedia, R.IndependentMedia, "IndependentMediaId",
                r => uk(val(r, 'FilePath')),
                'chooseLeft', 'IndependentMedia');
            // PlaylistItem: union (Accuracy points to a static lookup table, left untouched).
            let piMerge = unionTable(L.PlaylistItem, R.PlaylistItem, "PlaylistItemId");

            // Remap PlaylistItem references on TagMap BEFORE TagMap is merged below,
            // otherwise playlist tags would point to stale / non-existent items.
            updateForeignKeys(L.TagMap, "PlaylistItemId", piMerge.changesLeft);
            updateForeignKeys(R.TagMap, "PlaylistItemId", piMerge.changesRight);

            statusCallback("Merging TagMaps...");
            // A TagMap row identifies "this item belongs to this tag": exactly one of
            // PlaylistItemId / LocationId / NoteId is set (enforced by a CHECK), and the DB
            // additionally enforces UNIQUE(TagId, NoteId) and UNIQUE(TagId, LocationId) — an
            // item may appear at most once per tag. Position is only an ordering hint, so it
            // MUST NOT be part of the dedup key: if the same item sits in the same tag at a
            // different position in each backup (e.g. reordered on another device), keying on
            // position would keep both copies and violate UNIQUE(TagId, NoteId/LocationId).
            let tmMerge = mergeTable(L.TagMap, R.TagMap, "TagMapId",
                r => uk(val(r, 'TagId'), val(r, 'PlaylistItemId'), val(r, 'LocationId'), val(r, 'NoteId')),
                'chooseLeft', 'TagMap');

            // Distinct items from each backup can still collide on UNIQUE(TagId, Position)
            // once their tags merge into a shared TagId; renumber positions to fix that.
            reindexTagMapPositions(tmMerge.rows);

            statusCallback("Merging InputFields...");
            let ifMerge = mergeTable(L.InputField, R.InputField, null,
                r => uk(val(r, 'LocationId'), val(r, 'TextTag')),
                resolvers.inputFieldResolver, 'InputField');

            // ----- Playlist child tables: remap foreign keys, then concatenate -----
            // PlaylistItemMarker: remap its PlaylistItem reference, then union to get fresh
            // marker ids that its own child maps depend on.
            updateForeignKeys(L.PlaylistItemMarker, "PlaylistItemId", piMerge.changesLeft);
            updateForeignKeys(R.PlaylistItemMarker, "PlaylistItemId", piMerge.changesRight);
            let pimMerge = unionTable(L.PlaylistItemMarker, R.PlaylistItemMarker, "PlaylistItemMarkerId");

            // Marker child maps reference the marker id we just reassigned.
            updateForeignKeys(L.PlaylistItemMarkerBibleVerseMap, "PlaylistItemMarkerId", pimMerge.changesLeft);
            updateForeignKeys(R.PlaylistItemMarkerBibleVerseMap, "PlaylistItemMarkerId", pimMerge.changesRight);
            updateForeignKeys(L.PlaylistItemMarkerParagraphMap, "PlaylistItemMarkerId", pimMerge.changesLeft);
            updateForeignKeys(R.PlaylistItemMarkerParagraphMap, "PlaylistItemMarkerId", pimMerge.changesRight);

            // PlaylistItem map tables reference PlaylistItem plus one other entity.
            updateForeignKeys(L.PlaylistItemIndependentMediaMap, "PlaylistItemId", piMerge.changesLeft);
            updateForeignKeys(R.PlaylistItemIndependentMediaMap, "PlaylistItemId", piMerge.changesRight);
            updateForeignKeys(L.PlaylistItemIndependentMediaMap, "IndependentMediaId", imMerge.changesLeft);
            updateForeignKeys(R.PlaylistItemIndependentMediaMap, "IndependentMediaId", imMerge.changesRight);

            updateForeignKeys(L.PlaylistItemLocationMap, "PlaylistItemId", piMerge.changesLeft);
            updateForeignKeys(R.PlaylistItemLocationMap, "PlaylistItemId", piMerge.changesRight);
            updateForeignKeys(L.PlaylistItemLocationMap, "LocationId", locMerge.changesLeft);
            updateForeignKeys(R.PlaylistItemLocationMap, "LocationId", locMerge.changesRight);

            // These map tables use composite keys (no single PK to reassign); since playlist
            // and marker ids are freshly unique per side, simply concatenating is collision-free.
            const concat = (t) => [...L[t], ...R[t]];

            statusCallback("Writing Merged Database...");
            const writeData = {
                Location: locMerge.rows,
                Tag: tagMerge.rows,
                UserMark: umMerge.rows,
                BlockRange: brMerge.rows,
                Bookmark: bmMerge.rows,
                Note: noteMerge.rows,
                TagMap: tmMerge.rows,
                InputField: ifMerge.rows,
                IndependentMedia: imMerge.rows,
                PlaylistItem: piMerge.rows,
                PlaylistItemMarker: pimMerge.rows,
                PlaylistItemMarkerBibleVerseMap: concat("PlaylistItemMarkerBibleVerseMap"),
                PlaylistItemMarkerParagraphMap: concat("PlaylistItemMarkerParagraphMap"),
                PlaylistItemIndependentMediaMap: concat("PlaylistItemIndependentMediaMap"),
                PlaylistItemLocationMap: concat("PlaylistItemLocationMap")
            };

            for (let t of managedTables) {
                insertTable(mergedDb, t, Cols[t], writeData[t]);
            }

            // Copy every remaining table verbatim (static lookups + metadata such as
            // PlaylistItemAccuracy, LastModified, android_metadata, grdb_migrations, ...)
            // so nothing the merge doesn't understand is silently dropped. Prefer the left
            // side; fall back to right when left has no rows.
            statusCallback("Copying reference & metadata tables...");
            const otherTables = new Set(
                [...listTables(leftDb), ...listTables(rightDb)].filter(t => !managedTables.has(t))
            );
            for (const t of otherTables) {
                let ex = extractTable(leftDb, t);
                if (ex.rows.length === 0) {
                    const exR = extractTable(rightDb, t);
                    if (exR.columns.length > 0) ex = exR;
                }
                if (ex.columns.length > 0) insertTable(mergedDb, t, ex.columns, ex.rows);
            }

            // Stamp the merge time into the LastModified table (JW Library reads this value),
            // so the merged backup reflects when it was produced instead of inheriting the
            // left backup's old timestamp. Mirrors the manifest lastModifiedDate set below.
            // Format matches the app's: ISO-8601 seconds precision, e.g. 2026-07-17T20:30:45Z.
            try {
                if (tableExists(mergedDb, "LastModified")) {
                    const mergeStamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
                    mergedDb.run("DELETE FROM LastModified;");
                    mergedDb.run("INSERT INTO LastModified (LastModified) VALUES (?);", [mergeStamp]);
                }
            } catch (e) {
                console.warn("Could not update LastModified table.", e);
            }

            // Recreate indexes and triggers now that all data is loaded.
            statusCallback("Rebuilding indexes...");
            copySchemaObjects(leftDb, mergedDb, 'index');
            copySchemaObjects(leftDb, mergedDb, 'trigger');

            // Instead of creating a manifest from scratch (which causes JW Library on mobile to crash
            // due to strict validation), we clone the original left manifest and slightly alter it.
            statusCallback("Packaging components...");
            let finalManifest = {};

            // Generate SHA-256 hash of the final database (required by mobile app validation)
            const finalDbData = mergedDb.export();
            const hashBuffer = await crypto.subtle.digest('SHA-256', finalDbData);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const dbHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            try {
                const manifestFile = leftZip.file("manifest.json");
                if (manifestFile) {
                    const manifestText = await manifestFile.async("string");
                    finalManifest = JSON.parse(manifestText);

                    // Update only what's necessary, keep original shapes, hashes and device names untouched
                    finalManifest.name = "Library Save Merger";

                    // Keep original date formats but update them to now
                    const now = new Date();
                    if (finalManifest.creationDate) {
                        finalManifest.creationDate = now.toISOString().split('T')[0];
                    }
                    if (finalManifest.userDataBackup) {
                        finalManifest.userDataBackup.lastModifiedDate = now.toISOString();
                        finalManifest.userDataBackup.hash = dbHash;
                    }
                }
            } catch (e) {
                console.warn("Failed to parse original manifest, falling back to default.", e);
                finalManifest = {
                    name: "Library Save Merger",
                    creationDate: new Date().toISOString().split('T')[0],
                    version: 1,
                    type: 0,
                    userDataBackup: {
                        lastModifiedDate: new Date().toISOString(),
                        hash: dbHash,
                        deviceName: "LibraryMergerWeb",
                        databaseName: "userData.db",
                        schemaVersion: schemaVersion
                    }
                };
            }

            const finalZip = new JSZip();
            finalZip.file("userData.db", finalDbData);

            // Add required default thumbnail (required by JW Library on Android/iOS)
            if (typeof defaultThumbnailBase64 !== 'undefined') {
                finalZip.file("default_thumbnail.png", defaultThumbnailBase64, { base64: true });
            }

            // Also copy all other possible system files from the left zip (like .hash if they exist in future versions)
            leftZip.folder("").forEach((relativePath, file) => {
                if (relativePath === "userData.db" || relativePath === "manifest.json" || relativePath === "default_thumbnail.png") return;
                // Never carry over SQLite sidecar journals (-wal / -shm / -journal). The merged
                // userData.db is freshly written and self-contained; shipping the source backup's
                // stale write-ahead log makes SQLite (JW Library) replay old pages over the merge
                // on import, silently reverting or dropping merged data — notes, highlights, tags.
                if (/\.db-(wal|shm|journal)$/i.test(relativePath)) return;
                finalZip.file(relativePath, file.async("uint8array"));
            });
            finalZip.file("manifest.json", JSON.stringify(finalManifest, null, 2));

            statusCallback("Generating `.jwlibrary` file...");
            // Force application/octet-stream mimeType so mobile browsers (iOS/Safari) 
            // don't automatically append .zip to the download file name.
            return await finalZip.generateAsync({
                type: "blob",
                compression: "DEFLATE",
                mimeType: "application/octet-stream"
            });

        } finally {
            // Always close databases to free WebAssembly memory, even if an error occurred
            try { leftDb.close(); } catch (e) { }
            try { rightDb.close(); } catch (e) { }
            try { mergedDb.close(); } catch (e) { }
        }
    };

})();
