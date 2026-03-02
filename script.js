document.addEventListener('DOMContentLoaded', () => {
    // --- Internationalization (i18n) ---
    const translations = {
        en: {
            title: "Library Save Merger",
            subtitle: "Effortlessly combine two .jwlibrary backup files directly in your browser.",
            privacyBadge: "100% Local & Private. No data is sent to the internet.",
            warningText: "Warning: Always keep a safe copy of your original .jwlibrary files before merging to prevent any accidental data loss.",
            chooseLeft: "Choose <strong>Left Backup</strong> or drag it here",
            chooseRight: "Choose <strong>Right Backup</strong> or drag it here",
            noFile: "No file chosen",
            resolversTitle: "Conflict Resolvers",
            resolversDesc: "Choose how conflicts between the two files should be resolved automatically.",
            bookmarks: "Bookmarks",
            markings: "Markings",
            notes: "Notes",
            inputFields: "Input Fields",
            keepLeft: "Keep Left",
            keepRight: "Keep Right",
            keepNewest: "Keep Newest",
            mergeBtn: "Merge Backups",
            langBtn: "🇫🇷 FR",
            errFiles: "Please select both left and right .jwlibrary backup files.",
            initWasm: "Initializing WebAssembly... (This might take a moment if it's the first run)",
            errWasm: "Merger logic not loaded correctly. Please refresh.",
            extracting: "Extracting and Merging... Please wait.",
            downloading: "Merge completed! Downloading...",
            success: "Success! Your merged backup has been downloaded.",
            errExtension: "Invalid file type. Please upload a .jwlibrary file.",
            legalBtn: "Legal Mentions",
            privacyBtn: "Privacy Policy",
            creditsPrefix: "Inspired by",
            legalTitle: "Legal Mentions",
            privacyTitle: "Privacy Policy",
            legalText: `
                <h3>1. Publisher</h3>
                <p>This tool is an open-source, client-side web utility created for personal use and convenience.</p>
                <h3>2. Hosting</h3>
                <p>This project is served as a static webpage. No databases or backend servers are involved in data processing.</p>
                <h3>3. Intellectual Property</h3>
                <p>JW Library is a registered trademark of Watch Tower Bible and Tract Society of Pennsylvania. This tool is NOT affiliated with, endorsed by, or sponsored by Watch Tower. It is an independent utility designed to merge personal backup files.</p>
                <h3>4. Liability</h3>
                <p>This software is provided "as is", without warranty of any kind. The author shall not be held responsible for any lost data or corrupted backups. <strong>Always keep a copy of your original .jwlibrary files before merging.</strong></p>
            `,
            privacyText: `
                <h3>1. Data Processing</h3>
                <p>This application operates <strong>entirely locally within your web browser</strong> (client-side).</p>
                <h3>2. No Data Collection</h3>
                <p>We do not collect, transmit, store, or analyze your personal data, your backup files (.jwlibrary), your notes, your highlights, or your IP address.</p>
                <h3>3. File Handling</h3>
                <p>When you select or drop a backup file, it is read locally by your browser's memory using JavaScript (via JSZip and SQL.js). At no point does the file leave your device or get uploaded to a server.</p>
                <h3>4. Cookies</h3>
                <p>This application does not use tracking cookies or analytics.</p>
            `
        },
        fr: {
            title: "Library Save Merger",
            subtitle: "Combinez facilement deux fichiers de sauvegarde .jwlibrary directement dans votre navigateur.",
            privacyBadge: "100% Local & Privé. Aucune donnée n'est envoyée sur internet.",
            warningText: "Attention : Conservez toujours une copie de sécurité de vos fichiers .jwlibrary originaux avant la fusion pour éviter toute perte de données accidentelle.",
            chooseLeft: "Choisissez la <strong>sauvegarde de gauche</strong> ou glissez-la ici",
            chooseRight: "Choisissez la <strong>sauvegarde de droite</strong> ou glissez-la ici",
            noFile: "Aucun fichier choisi",
            resolversTitle: "Résolution des conflits",
            resolversDesc: "Choisissez comment les conflits entre les deux fichiers doivent être résolus automatiquement.",
            bookmarks: "Signets",
            markings: "Surlignages",
            notes: "Notes",
            inputFields: "Champs de texte",
            keepLeft: "Garder Gauche",
            keepRight: "Garder Droite",
            keepNewest: "Garder le plus récent",
            mergeBtn: "Fusionner les sauvegardes",
            langBtn: "🇬🇧 EN",
            errFiles: "Veuillez sélectionner les fichiers de sauvegarde .jwlibrary de gauche et de droite.",
            initWasm: "Initialisation (Cela peut prendre un instant la première fois)...",
            errWasm: "La logique de fusion n'a pas été chargée. Veuillez rafraîchir la page.",
            extracting: "Extraction et Fusion... Veuillez patienter.",
            downloading: "Fusion terminée ! Téléchargement en cours...",
            success: "Succès ! Votre sauvegarde fusionnée a été téléchargée.",
            errExtension: "Type de fichier invalide. Veuillez importer un fichier .jwlibrary.",
            legalBtn: "Mentions Légales",
            privacyBtn: "Politique de Confidentialité",
            creditsPrefix: "Inspiré par",
            legalTitle: "Mentions Légales",
            privacyTitle: "Politique de Confidentialité",
            legalText: `
                <h3>1. Éditeur</h3>
                <p>Cet outil est un utilitaire web open-source exécuté côté client, créé pour des besoins personnels et pratiques.</p>
                <h3>2. Hébergement</h3>
                <p>Ce projet est diffusé sous forme de page web statique. Aucun serveur ou base de données distant n'intervient dans le traitement des données.</p>
                <h3>3. Propriété Intellectuelle</h3>
                <p>JW Library est une marque déposée de Watch Tower Bible and Tract Society of Pennsylvania. Cet outil n'est PAS affilié, approuvé ou sponsorisé par Watch Tower. C'est un utilitaire indépendant conçu pour fusionner des fichiers de sauvegarde personnels.</p>
                <h3>4. Responsabilité</h3>
                <p>Ce logiciel est fourni tel quel, sans aucune garantie. L'auteur ne saurait être tenu responsable en cas de perte de données ou de corruption de sauvegarde. <strong>Conservez toujours une copie de vos fichiers originaux .jwlibrary avant toute fusion.</strong></p>
            `,
            privacyText: `
                <h3>1. Traitement des données</h3>
                <p>Cette application fonctionne <strong>intégralement et localement dans votre navigateur web</strong> (côté client).</p>
                <h3>2. Aucune collecte de données</h3>
                <p>Nous ne collectons, transmettons, stockons ou analysons aucune donnée personnelle, ni vos fichiers de sauvegarde (.jwlibrary), ni vos notes, ni vos surlignages, ni votre adresse IP.</p>
                <h3>3. Traitement des fichiers</h3>
                <p>Lorsque vous sélectionnez ou déposez un fichier de sauvegarde, celui-ci est lu localement par la mémoire de votre navigateur via JavaScript (JSZip et SQL.js). À aucun moment le fichier ne quitte votre appareil ou n'est envoyé vers un serveur.</p>
                <h3>4. Cookies</h3>
                <p>Cette application n'utilise ni cookies de suivi ni outils d'analyse.</p>
            `
        }
    };

    let currentLang = 'en';
    const langBtn = document.getElementById('lang-btn');

    function updateLanguage() {
        const dict = translations[currentLang];

        // Update elements with data-i18n
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (dict[key]) {
                el.innerHTML = dict[key];
            }
        });

        // Update language button
        if (langBtn) {
            langBtn.textContent = dict.langBtn;
        }

        // Update file name displays if no files are selected
        const leftInput = document.getElementById('leftFile');
        const rightInput = document.getElementById('rightFile');

        if (!leftInput.files || leftInput.files.length === 0) {
            document.getElementById('file-name-left').textContent = dict.noFile;
        }
        if (!rightInput.files || rightInput.files.length === 0) {
            document.getElementById('file-name-right').textContent = dict.noFile;
        }
    }

    langBtn.addEventListener('click', (e) => {
        e.preventDefault();
        currentLang = currentLang === 'en' ? 'fr' : 'en';
        updateLanguage();
    });

    // Apply translations on initial load
    updateLanguage();

    // Helper to get translatable messages elsewhere in script
    function _t(key) {
        return translations[currentLang][key] || key;
    }

    const fileInputs = document.querySelectorAll('input[type="file"]');
    const form = document.getElementById('merge-form');
    const submitBtn = document.getElementById('submit-btn');
    const errorToast = document.getElementById('error-message');
    const statusToast = document.getElementById('status-message');

    function showError(msg) {
        errorToast.textContent = msg;
        errorToast.classList.remove('hidden');
        statusToast.classList.add('hidden');
    }

    function showStatus(msg) {
        statusToast.textContent = msg;
        statusToast.classList.remove('hidden');
        errorToast.classList.add('hidden');
    }

    function hideMessages() {
        errorToast.classList.add('hidden');
        statusToast.classList.add('hidden');
    }

    // Catch global errors to display them easily for debugging
    window.addEventListener('error', (e) => {
        let msg = "Global Error: " + e.message;
        if (e.filename) msg += " at " + e.filename + ":" + e.lineno;
        showError(msg);
    });

    window.addEventListener('unhandledrejection', (e) => {
        showError("Promise Error: " + (e.reason && e.reason.message ? e.reason.message : e.reason));
    });

    // Handle Drag and Drop visuals + File selection text
    fileInputs.forEach(input => {
        const dropArea = input.closest('.file-drop-area');
        const fileNameDisplay = dropArea.querySelector('.file-name');

        // Drag events
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropArea.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            dropArea.addEventListener(eventName, () => {
                dropArea.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropArea.addEventListener(eventName, (e) => {
                dropArea.classList.remove('dragover');
                if (eventName === 'drop') {
                    const dt = e.dataTransfer;
                    if (dt && dt.files && dt.files.length > 0) {
                        input.files = dt.files;
                        // Trigger change event manually
                        const event = new Event('change');
                        input.dispatchEvent(event);
                    }
                }
            }, false);
        });

        input.addEventListener('change', function (e) {
            hideMessages();
            if (this.files && this.files.length > 0) {
                const file = this.files[0];
                const fileName = file.name;

                // Validate extension
                if (!fileName.toLowerCase().endsWith('.jwlibrary')) {
                    showError(_t('errExtension'));
                    this.value = ''; // clear invalid selection
                    fileNameDisplay.style.display = 'none';
                    dropArea.classList.remove('loaded');
                    return;
                }

                // Validate file size (max 100 MB)
                const MAX_SIZE_MB = 100;
                if (file.size > MAX_SIZE_MB * 1024 * 1024) {
                    showError(`File too large (max ${MAX_SIZE_MB} MB). Please choose a smaller backup.`);
                    this.value = '';
                    fileNameDisplay.style.display = 'none';
                    dropArea.classList.remove('loaded');
                    return;
                }

                fileNameDisplay.textContent = fileName;
                fileNameDisplay.style.display = 'inline-block';
                dropArea.classList.add('loaded');
            } else {
                fileNameDisplay.style.display = 'none';
                dropArea.classList.remove('loaded');
            }
        });

        // Handle Remove Button
        const removeBtn = dropArea.querySelector('.remove-file-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation(); // prevent triggering the file input click
                input.value = ''; // clear the input
                // Manually trigger change to reset UI
                const event = new Event('change');
                input.dispatchEvent(event);
            });
        }
    });

    // Handle Switch Buttons
    const switchBtns = document.querySelectorAll('.switch-btn');
    switchBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            // Get the target hidden input
            const targetId = btn.getAttribute('data-target');
            const targetInput = document.getElementById(targetId);
            const value = btn.getAttribute('data-value');

            // Remove active class from siblings
            const container = btn.closest('.switch-container');
            container.querySelectorAll('.switch-btn').forEach(b => b.classList.remove('active'));

            // Set active class on clicked button
            btn.classList.add('active');

            // Update hidden input value
            if (targetInput) {
                targetInput.value = value;
            }
        });
    });

    // Handle Form Submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMessages();

        const leftInput = document.getElementById('leftFile');
        const rightInput = document.getElementById('rightFile');

        if (leftInput.files.length === 0 || rightInput.files.length === 0) {
            showError(_t('errFiles'));
            return;
        }

        const resolvers = {
            bookmarkResolver: document.getElementById('bookmarkResolver').value,
            markingResolver: document.getElementById('markingResolver').value,
            noteResolver: document.getElementById('noteResolver').value,
            inputFieldResolver: document.getElementById('inputFieldResolver').value,
        };

        submitBtn.classList.add('loading');
        submitBtn.disabled = true;

        try {
            showStatus(_t('initWasm'));

            // Assume mergeJWLibrary is globally available from merger.js
            if (typeof window.mergeJWLibrary !== 'function') {
                throw new Error(_t('errWasm'));
            }

            const leftFile = leftInput.files[0];
            const rightFile = rightInput.files[0];

            showStatus(_t('extracting'));

            const mergedBlob = await window.mergeJWLibrary(leftFile, rightFile, resolvers, (status) => {
                // To keep this generic, merger.js outputs english logs, we don't fully translate them, just show them as english status updates
                showStatus(status);
            });

            // Create download link
            showStatus(_t('downloading'));
            const downloadUrl = URL.createObjectURL(mergedBlob);
            const a = document.createElement('a');
            a.href = downloadUrl;

            // Format filename with current date like default backups
            const date = new Date();
            const dateStr = date.toISOString().split('T')[0];
            a.download = `MergedBackup_${dateStr}.jwlibrary`;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(downloadUrl);
            a.remove();

            showStatus(_t('success'));

        } catch (error) {
            console.error(error);
            showError(error.message || "An unexpected error occurred during the merge process.");
        } finally {
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;
        }
    });

    // --- Legal and Privacy Modal ---
    const legalBtnModal = document.getElementById('legal-btn');
    const privacyBtnModal = document.getElementById('privacy-btn');
    const modal = document.getElementById('info-modal');
    const modalClose = document.getElementById('modal-close');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');

    function openModal(titleKey, textKey) {
        modalTitle.textContent = _t(titleKey);
        // Note: legalText/privacyText are hardcoded trusted HTML strings — never pass external content here.
        modalBody.innerHTML = _t(textKey);
        modal.classList.remove('hidden');
        // Move focus to close button for keyboard and screen-reader accessibility
        if (modalClose) modalClose.focus();
    }

    function closeModal() {
        modal.classList.add('hidden');
    }

    if (legalBtnModal) {
        legalBtnModal.addEventListener('click', (e) => {
            e.preventDefault();
            openModal('legalTitle', 'legalText');
        });
    }

    if (privacyBtnModal) {
        privacyBtnModal.addEventListener('click', (e) => {
            e.preventDefault();
            openModal('privacyTitle', 'privacyText');
        });
    }

    if (modalClose) {
        modalClose.addEventListener('click', closeModal);
    }

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
    }

    // Add escape key handler to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeModal();
        }
    });
});
