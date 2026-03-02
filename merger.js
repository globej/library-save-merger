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
            const tablesToMerge = [
                "Location", "Tag", "UserMark", "BlockRange", "Bookmark",
                "Note", "TagMap", "InputField"
            ];

            for (let t of tablesToMerge) {
                cloneTableSchema(leftDb, mergedDb, t);
            }

            // Helper to get unique key string safely handling nulls
            const uk = (...args) => args.map(a => a === null || a === undefined ? '' : String(a)).join('_');

            // Extract tables
            let L = {}, R = {}, Cols = {};
            for (let t of tablesToMerge) {
                let exL = extractTable(leftDb, t);
                let exR = extractTable(rightDb, t);
                L[t] = exL.rows;
                R[t] = exR.rows;
                Cols[t] = exL.columns.length > 0 ? exL.columns : exR.columns;
            }

            statusCallback("Merging Locations...");
            let locMerge = mergeTable(L.Location, R.Location, "LocationId",
                r => uk(val(r, 'BookNumber'), val(r, 'ChapterNumber'), val(r, 'DocumentId'), val(r, 'Track'), val(r, 'IssueTagNumber'), val(r, 'KeySymbol'), val(r, 'MepsLanguage'), val(r, 'Type')),
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

            statusCallback("Merging Bookmarks...");
            let bmMerge = mergeTable(L.Bookmark, R.Bookmark, "BookmarkId",
                r => uk(val(r, 'PublicationLocationId'), val(r, 'Slot')),
                resolvers.bookmarkResolver, 'Bookmark');

            statusCallback("Merging Notes...");
            let noteMerge = mergeTable(L.Note, R.Note, "NoteId",
                r => uk(val(r, 'Guid')),
                resolvers.noteResolver, 'Note');

            updateForeignKeys(L.TagMap, "NoteId", noteMerge.changesLeft);
            updateForeignKeys(R.TagMap, "NoteId", noteMerge.changesRight);

            statusCallback("Merging TagMaps...");
            let tmMerge = mergeTable(L.TagMap, R.TagMap, "TagMapId",
                r => uk(val(r, 'PlaylistItemId'), val(r, 'LocationId'), val(r, 'NoteId'), val(r, 'TagId'), val(r, 'Position')),
                'chooseLeft', 'TagMap');

            statusCallback("Merging InputFields...");
            let ifMerge = mergeTable(L.InputField, R.InputField, null,
                r => uk(val(r, 'LocationId'), val(r, 'TextTag')),
                resolvers.inputFieldResolver, 'InputField');

            statusCallback("Writing Merged Database...");
            const writeData = {
                Location: locMerge.rows,
                Tag: tagMerge.rows,
                UserMark: umMerge.rows,
                BlockRange: brMerge.rows,
                Bookmark: bmMerge.rows,
                Note: noteMerge.rows,
                TagMap: tmMerge.rows,
                InputField: ifMerge.rows
            };

            for (let t of tablesToMerge) {
                insertTable(mergedDb, t, Cols[t], writeData[t]);
            }

            // Create new manifest
            statusCallback("Packaging components...");
            const defaultManifest = {
                name: "Library Save Merger",
                creationDate: new Date().toISOString().split('T')[0],
                version: 1,
                type: 0,
                userDataBackup: {
                    lastModifiedDate: new Date().toISOString(),
                    deviceName: "LibraryMergerWeb",
                    databaseName: "userData.db",
                    schemaVersion: schemaVersion
                }
            };

            const finalDbData = mergedDb.export();

            const finalZip = new JSZip();
            finalZip.file("userData.db", finalDbData);
            finalZip.file("manifest.json", JSON.stringify(defaultManifest, null, 2));

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
