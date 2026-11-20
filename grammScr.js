async function loadXML(filePath) {
    const response = await fetch(filePath);
    if (!response.ok) {
        throw new Error(`Could not load ${filePath}: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, 'text/xml');
    const parserError = xml.querySelector('parsererror');

    if (parserError) {
        throw new Error(`Invalid XML in ${filePath}: ${parserError.textContent}`);
    }

    return xml;
}

async function loadGrammar() {
    try {
        const [greekDoc, englishDoc] = await Promise.all([
            loadXML('TEXT/grammarGreek.xml'),
            loadXML('TEXT/grammarEnglish.xml')
        ]);

        const container = document.getElementById('grammar-container');
        container.innerHTML = '';

        const greekSections = greekDoc.querySelectorAll('section');
        const englishSections = englishDoc.querySelectorAll('section');
        const englishMap = {};

        englishSections.forEach(sec => {
            const n = sec.getAttribute('n');
            if (n) englishMap[n] = sec;
        });

        function escapeHtml(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function renderSectionContent(section) {
            let html = '';
            const n = section.getAttribute('n');

            if (n) {
                html += `<div class="section-number">§ ${escapeHtml(n)}</div>`;
            }

            const head = section.querySelector('head');

            if (head) {
                html += `<div class="section-head">${escapeHtml(head.textContent)}</div>`;
            }

            for (const child of section.children) {
                if (child.tagName === 'head') continue;

                const tag = child.tagName.toLowerCase();

                if (tag === 'p') {
                    html += `<p>${escapeHtml(child.textContent)}</p>`;
                } else if (tag === 'list') {
                    html += '<list>';

                    child.querySelectorAll('item').forEach(item => {
                        html += `<item>${escapeHtml(item.textContent)}</item>`;
                    });

                    html += '</list>';
                } else if (tag === 'quote') {
                    html += `<quote>${escapeHtml(child.textContent)}</quote>`;
                } else {
                    html += `<${tag}>${escapeHtml(child.textContent)}</${tag}>`;
                }
            }

            return html;
        }

        greekSections.forEach(greekSec => {
            const n = greekSec.getAttribute('n');
            const englishSec = englishMap[n];

            const pair = document.createElement('div');
            pair.className = 'section-pair';
            pair.dataset.n = n || '';

            const greekCol = document.createElement('div');
            greekCol.className = 'greek alpheios-enabled';
            greekCol.setAttribute('lang', 'grc');
            greekCol.innerHTML = renderSectionContent(greekSec);

            pair.appendChild(greekCol);

            const engCol = document.createElement('div');
            engCol.className = 'english';
            engCol.setAttribute('data-alpheios-ignore', 'all');

            if (englishSec) {
                engCol.innerHTML = renderSectionContent(englishSec);
            } else {
                engCol.innerHTML = '<p><em>(No matching section)</em></p>';
            }

            pair.appendChild(engCol);
            container.appendChild(pair);
        });

        // SECTION NAVIGATION

        const sectionSelect = document.getElementById('section-select');

        while (sectionSelect.options.length > 1) {
            sectionSelect.remove(1);
        }

        const placeholder = sectionSelect.options[0];

        if (placeholder) {
            placeholder.textContent = '— Choose section —';
            placeholder.style.textAlign = 'center';
        }

        greekSections.forEach(sec => {
            const n = sec.getAttribute('n');
            const head = sec.querySelector('head');

            if (!n) return;

            const option = document.createElement('option');
            option.value = n;
            option.textContent = `§ ${n} – ${head ? head.textContent.trim() : ''}`;

            sectionSelect.appendChild(option);
        });

        sectionSelect.addEventListener('change', () => {
            const n = sectionSelect.value;
            if (!n) return;

            const target = document.querySelector(
                `.section-pair[data-n="${CSS.escape(n)}"]`
            );

            if (target) {
                history.pushState(
                    null,
                    '',
                    `#section-${encodeURIComponent(n)}`
                );

                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }

            sectionSelect.value = '';
        });

        // ENGLISH TOGGLE

        const englishToggle = document.getElementById('english-toggle');

        function setEnglish(on) {
            document.body.classList.toggle('english-on', on);
        }

        englishToggle.checked = false;
        setEnglish(false);

        englishToggle.addEventListener('change', () => {
            setEnglish(englishToggle.checked);
        });

        // URL HASH NAVIGATION

        function goToSectionFromHash() {
            const hash = window.location.hash;

            if (hash && hash.startsWith('#section-')) {
                const n = decodeURIComponent(
                    hash.replace('#section-', '')
                );

                const target = document.querySelector(
                    `.section-pair[data-n="${CSS.escape(n)}"]`
                );

                if (target) {
                    window.setTimeout(() => {
                        target.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start'
                        });
                    }, 200);
                }
            }
        }

        window.addEventListener('hashchange', goToSectionFromHash);

        // SEARCH FUNCTIONALITY

        (function () {
            const input = document.getElementById('search-input');
            const button = document.getElementById('search-button');
            const accentMode = document.getElementById('search-accent-mode');
            const content = document.getElementById('grammar-container');

            let currentMatchIndex = -1;
            let matches = [];

            function clearHighlights() {
                content.querySelectorAll('mark').forEach(mark => {
                    const parent = mark.parentNode;

                    parent.replaceChild(
                        document.createTextNode(mark.textContent),
                        mark
                    );

                    parent.normalize();
                });
            }

            // Normalize text for searching while retaining a map back to
            // the original UTF-16 character positions.

            function normalizeWithMap(value, ignoreAccents) {
                let normalized = '';
                const originalStarts = [];
                const originalEnds = [];

                let sourceOffset = 0;

                for (const character of value) {
                    const originalStart = sourceOffset;
                    sourceOffset += character.length;

                    let piece = character.normalize('NFD').toLocaleLowerCase();

                    if (ignoreAccents) {
                        piece = piece.replace(/\p{M}/gu, '');
                    }

                    // Treat Greek final sigma and ordinary sigma as equivalent.
                    piece = piece.replace(/ς/g, 'σ');

                    // Extend the preceding character's mapped range when
                    // a decomposed accent is removed.

                    if (!piece && ignoreAccents && originalEnds.length > 0) {
                        originalEnds[originalEnds.length - 1] = sourceOffset;
                    }

                    for (const normalizedCharacter of piece) {
                        normalized += normalizedCharacter;

                        for (let i = 0; i < normalizedCharacter.length; i++) {
                            originalStarts.push(originalStart);
                            originalEnds.push(sourceOffset);
                        }
                    }
                }

                return {
                    text: normalized,
                    starts: originalStarts,
                    ends: originalEnds
                };
            }

            function highlightText(query) {
                clearHighlights();

                matches = [];
                currentMatchIndex = -1;

                if (!query.trim()) return;

                const ignoreAccents = accentMode.value === 'insensitive';

                const normalizedQuery = normalizeWithMap(
                    query,
                    ignoreAccents
                ).text;

                if (!normalizedQuery) return;

                const escaped = normalizedQuery.replace(
                    /[.*+?^${}()|[\]\\]/g,
                    '\\$&'
                );

                const searchRegex = new RegExp(escaped, 'g');

                const walker = document.createTreeWalker(
                    content,
                    NodeFilter.SHOW_TEXT,
                    {
                        acceptNode(node) {
                            const parent = node.parentNode;

                            if (
                                !parent ||
                                parent.nodeName === 'SCRIPT' ||
                                parent.nodeName === 'STYLE' ||
                                parent.closest('.search-container') ||
                                parent.closest('.site-header')
                            ) {
                                return NodeFilter.FILTER_REJECT;
                            }

                            return NodeFilter.FILTER_ACCEPT;
                        }
                    }
                );

                const nodesToProcess = [];
                let node;

                while ((node = walker.nextNode())) {
                    nodesToProcess.push(node);
                }

                nodesToProcess.forEach(textNode => {
                    const originalText = textNode.textContent;

                    const mapped = normalizeWithMap(
                        originalText,
                        ignoreAccents
                    );

                    if (!mapped.text) return;

                    const fragment = document.createDocumentFragment();

                    let lastOriginalIndex = 0;

                    searchRegex.lastIndex = 0;

                    let match;

                    while ((match = searchRegex.exec(mapped.text)) !== null) {
                        const normalizedStart = match.index;
                        const normalizedEnd = searchRegex.lastIndex - 1;

                        const originalStart = mapped.starts[normalizedStart];
                        const originalEnd = mapped.ends[normalizedEnd];

                        if (
                            originalStart === undefined ||
                            originalEnd === undefined ||
                            originalStart < lastOriginalIndex
                        ) {
                            continue;
                        }

                        if (originalStart > lastOriginalIndex) {
                            fragment.appendChild(
                                document.createTextNode(
                                    originalText.slice(
                                        lastOriginalIndex,
                                        originalStart
                                    )
                                )
                            );
                        }

                        const mark = document.createElement('mark');

                        mark.textContent = originalText.slice(
                            originalStart,
                            originalEnd
                        );

                        fragment.appendChild(mark);

                        lastOriginalIndex = originalEnd;
                    }

                    if (lastOriginalIndex === 0) return;

                    if (lastOriginalIndex < originalText.length) {
                        fragment.appendChild(
                            document.createTextNode(
                                originalText.slice(lastOriginalIndex)
                            )
                        );
                    }

                    textNode.parentNode.replaceChild(fragment, textNode);
                });

                matches = Array.from(
                    content.querySelectorAll('mark')
                );
            }

            function goToNextMatch() {
                if (matches.length === 0) return;

                currentMatchIndex =
                    (currentMatchIndex + 1) % matches.length;

                matches[currentMatchIndex].scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            }

            input.addEventListener('input', () => {
                highlightText(input.value);
            });

            accentMode.addEventListener('change', () => {
                highlightText(input.value);
            });

            input.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();

                    if (matches.length > 0) {
                        goToNextMatch();
                    }
                }
            });

            button.addEventListener('click', () => {
                highlightText(input.value);

                if (matches.length > 0) {
                    goToNextMatch();
                }

                input.focus();
            });
        })();

        // BACK TO TOP

        const backBtn = document.getElementById('back-to-top');

        window.addEventListener('scroll', () => {
            if (window.scrollY > 400) {
                backBtn.classList.add('visible');
            } else {
                backBtn.classList.remove('visible');
            }
        });

        backBtn.addEventListener('click', () => {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });

        // AUTOMATIC URL HASH UPDATING

        let scrollTimeout = null;

        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);

            scrollTimeout = window.setTimeout(() => {
                if (window.scrollY <= 100) return;

                const pairs = document.querySelectorAll('.section-pair');

                let current = null;
                const scrollPos = window.scrollY + 120;

                pairs.forEach(pair => {
                    if (pair.offsetTop <= scrollPos) {
                        current = pair;
                    }
                });

                if (current) {
                    const n = current.dataset.n;

                    if (
                        n &&
                        window.location.hash !== `#section-${n}`
                    ) {
                        history.replaceState(
                            null,
                            '',
                            `#section-${encodeURIComponent(n)}`
                        );
                    }
                }
            }, 150);
        });

        // READING POSITION MEMORY

        const STORAGE_KEY = 'grammar-reading-position';

        function savePosition() {
            const scrollY = window.scrollY;

            const englishVisible =
                document.body.classList.contains('english-on');

            // Do not create a resume record for an untouched first-entry page.

            if (scrollY <= 100 && !englishVisible) {
                localStorage.removeItem(STORAGE_KEY);
                return;
            }

            const data = {
                scrollY: scrollY,
                englishVisible: englishVisible,
                timestamp: Date.now()
            };

            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(data)
            );
        }

        function clearPreviousReadingState() {
            localStorage.removeItem(STORAGE_KEY);

            // Remove the legacy key used by the previous version.

            localStorage.removeItem('grammar-english-visible');

            englishToggle.checked = false;
            setEnglish(false);

            window.scrollTo(0, 0);

            clearTimeout(scrollTimeout);

            if (window.location.hash) {
                history.replaceState(
                    null,
                    '',
                    window.location.pathname + window.location.search
                );
            }
        }

        const saved = localStorage.getItem(STORAGE_KEY);

        let resumedPreviousSession = false;

        localStorage.removeItem('grammar-english-visible');

        if (saved) {
            try {
                const data = JSON.parse(saved);

                const isRecent =
                    data &&
                    Number.isFinite(data.timestamp) &&
                    Date.now() - data.timestamp <
                    30 * 24 * 60 * 60 * 1000;

                if (isRecent) {
                    const wantsToResume = confirm(
                        'Continue where you left off?'
                    );

                    if (wantsToResume) {
                        resumedPreviousSession = true;

                        englishToggle.checked = Boolean(
                            data.englishVisible
                        );

                        setEnglish(englishToggle.checked);

                        const savedScrollY =
                            Number.isFinite(data.scrollY)
                                ? Math.max(0, data.scrollY)
                                : 0;

                        window.setTimeout(() => {
                            window.scrollTo(0, savedScrollY);
                        }, 300);

                    } else {
                        clearPreviousReadingState();
                    }

                } else {
                    localStorage.removeItem(STORAGE_KEY);
                }

            } catch (error) {
                console.warn(
                    'Could not restore position; starting from the beginning.',
                    error
                );

                localStorage.removeItem(STORAGE_KEY);
            }
        }

        if (!resumedPreviousSession) {
            goToSectionFromHash();
        }

        window.setInterval(savePosition, 4000);

        window.addEventListener('beforeunload', savePosition);

        // ALPHEIOS INTEGRATION

        import(
            'https://cdn.jsdelivr.net/npm/alpheios-embedded@latest/dist/alpheios-embedded.min.js'
        )
            .then(() => {
                return window.AlpheiosEmbed.importDependencies({
                    mode: 'cdn'
                });
            })
            .then(Embedded => {
                new Embedded({
                    clientId: 'grammatical-techne',
                    enabledSelector: '.alpheios-enabled',
                    simpleMode: false,
                    toolbarInitialPos: {
                        top: '140px',
                        right: '15px'
                    },
                    popupInitialPos: {
                        top: '160px',
                        left: '10vw'
                    }
                }).activate();
            })
            .catch(error => {
                console.error('Alpheios failed to load:', error);
            });

        // EXPORT CONTROLS

        (function () {
            const langSelect = document.getElementById('export-lang');
            const buttons = document.querySelectorAll('.export-btn');

            function getSectionData() {
                const pairs = document.querySelectorAll('.section-pair');

                const data = [];

                pairs.forEach(pair => {
                    const n = pair.dataset.n;

                    const greekEl = pair.querySelector('.greek');
                    const engEl = pair.querySelector('.english');

                    const greekHead =
                        greekEl.querySelector('.section-head')
                            ?.textContent.trim() || '';

                    const engHead =
                        engEl.querySelector('.section-head')
                            ?.textContent.trim() || '';

                    function collectText(el) {
                        const parts = [];

                        el.querySelectorAll(
                            'p, quote, item, .section-number'
                        ).forEach(node => {
                            const t = node.textContent.trim();

                            if (t) {
                                parts.push(t);
                            }
                        });

                        return parts.join('\n\n');
                    }

                    data.push({
                        n: n,
                        greekHead: greekHead,
                        engHead: engHead,
                        greek: collectText(greekEl),
                        english: collectText(engEl)
                    });
                });

                return data;
            }

            // FILE DOWNLOAD

            function download(filename, content, mime) {
                const blob = new Blob(
                    [content],
                    { type: mime }
                );

                const url = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.href = url;
                a.download = filename;

                document.body.appendChild(a);
                a.click();
                a.remove();

                window.setTimeout(() => {
                    URL.revokeObjectURL(url);
                }, 1000);
            }

            // TXT EXPORT

            function buildTxt(sections, mode) {
                let out =
                    'GRAMMATICAL TECHNE\n' +
                    '='.repeat(40) +
                    '\n\n';

                sections.forEach(s => {
                    out += `§ ${s.n}\n`;

                    if (mode !== 'english') {
                        out +=
                            s.greekHead +
                            '\n' +
                            s.greek +
                            '\n\n';
                    }

                    if (mode !== 'greek') {
                        out +=
                            (mode === 'both' ? 'ENGLISH\n' : '') +
                            s.engHead +
                            '\n' +
                            s.english +
                            '\n\n';
                    }

                    out +=
                        '-'.repeat(40) +
                        '\n\n';
                });

                return out;
            }

            // MARKDOWN EXPORT

            function buildMd(sections, mode) {
                let out = '# Grammatical Techne\n\n';

                sections.forEach(s => {
                    out += `## § ${s.n}\n\n`;

                    if (mode !== 'english') {
                        out += `### ${s.greekHead}\n\n`;

                        out +=
                            s.greek.replace(/\n{3,}/g, '\n\n') +
                            '\n\n';
                    }

                    if (mode !== 'greek') {
                        out += `### ${s.engHead}\n\n`;

                        out +=
                            s.english.replace(/\n{3,}/g, '\n\n') +
                            '\n\n';
                    }

                    out += '---\n\n';
                });

                return out;
            }

            // XML EXPORT

            function buildXml(sections, mode) {
                let out =
                    '<?xml version="1.0" encoding="UTF-8"?>\n' +
                    '<work>\n';

                sections.forEach(s => {
                    out += ` <section n="${escapeXml(s.n)}">\n`;

                    if (mode !== 'english') {
                        out +=
                            `  <head>${escapeXml(s.greekHead)}</head>\n`;

                        out +=
                            `  <p>${escapeXml(s.greek)}</p>\n`;
                    }

                    if (mode !== 'greek') {
                        out +=
                            `  <head lang="en">${escapeXml(s.engHead)}</head>\n`;

                        out +=
                            `  <p lang="en">${escapeXml(s.english)}</p>\n`;
                    }

                    out += ' </section>\n';
                });

                out += '</work>';

                return out;
            }

            // JSON EXPORT

            function buildJson(sections, mode) {
                const cleaned = sections.map(s => {
                    const obj = {
                        n: s.n
                    };

                    if (mode !== 'english') {
                        obj.greek = {
                            head: s.greekHead,
                            text: s.greek
                        };
                    }

                    if (mode !== 'greek') {
                        obj.english = {
                            head: s.engHead,
                            text: s.english
                        };
                    }

                    return obj;
                });

                return JSON.stringify(cleaned, null, 2);
            }

            // XML ESCAPING

            function escapeXml(str) {
                return String(str)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&apos;');
            }

            // PDF EXPORT
            //
            // The PDF source is kept inside the document so html2pdf can
            // measure it correctly. It is hidden from the live page.
            //
            // html2canvas's cloned document makes the source visible and
            // correctly positioned before capturing it.

            async function exportPdf(sections, mode) {
                if (typeof window.html2pdf !== 'function') {
                    throw new Error(
                        'The PDF library did not load. Check your internet connection and reload the page.'
                    );
                }

                if (!Array.isArray(sections) || sections.length === 0) {
                    throw new Error(
                        'There is no grammar content available to export.'
                    );
                }

                const pdfRoot = document.createElement('article');

                pdfRoot.id = 'pdf-export-root';
                pdfRoot.className = 'pdf-export-document';

                Object.assign(pdfRoot.style, {
                    position: 'fixed',
                    left: '0',
                    top: '0',
                    width: '760px',
                    padding: '48px',
                    boxSizing: 'border-box',
                    background: '#ffffff',
                    color: '#2c241c',
                    fontFamily:
                        '"Gentium Plus", "Palatino Linotype", Palatino, Georgia, serif',
                    fontSize: '15px',
                    lineHeight: '1.55',
                    visibility: 'hidden',
                    pointerEvents: 'none',
                    zIndex: '-1'
                });

                // DOCUMENT TITLE

                const title = document.createElement('h1');

                title.textContent = 'GRAMMATICAL TECHNE';

                Object.assign(title.style, {
                    margin: '0 0 28px',
                    textAlign: 'center',
                    fontSize: '25px',
                    letterSpacing: '0.08em',
                    color: '#6b3a28',
                    fontFamily:
                        '"Gentium Plus", "Palatino Linotype", Palatino, Georgia, serif'
                });

                pdfRoot.appendChild(title);

                // SECTIONS

                sections.forEach(sectionData => {
                    const section = document.createElement('section');

                    section.className = 'pdf-section';

                    Object.assign(section.style, {
                        marginBottom: '30px',
                        breakInside: 'auto',
                        pageBreakInside: 'auto'
                    });

                    const sectionHeading = document.createElement('h2');

                    sectionHeading.textContent =
                        `§ ${sectionData.n}`;

                    Object.assign(sectionHeading.style, {
                        margin: '0 0 10px',
                        paddingBottom: '4px',
                        borderBottom: '1px solid #d4c9b4',
                        color: '#6b3a28',
                        fontSize: '18px',
                        breakAfter: 'avoid',
                        pageBreakAfter: 'avoid'
                    });

                    section.appendChild(sectionHeading);

                    // APPEND GREEK OR ENGLISH TEXT

                    function appendTextBlock(
                        headingText,
                        bodyText,
                        isEnglish = false
                    ) {
                        const heading = document.createElement('h3');

                        heading.textContent = headingText;

                        Object.assign(heading.style, {
                            margin: '16px 0 6px',
                            color: '#5c4f42',
                            fontSize: '15px',
                            breakAfter: 'avoid',
                            pageBreakAfter: 'avoid'
                        });

                        section.appendChild(heading);

                        const body = document.createElement('div');

                        body.textContent = bodyText;

                        Object.assign(body.style, {
                            margin: '0 0 12px',
                            whiteSpace: 'pre-wrap',
                            overflowWrap: 'break-word',
                            color: isEnglish
                                ? '#5c4f42'
                                : '#2c241c',
                            fontSize: isEnglish
                                ? '14px'
                                : '15px'
                        });

                        section.appendChild(body);
                    }

                    if (mode !== 'english') {
                        appendTextBlock(
                            sectionData.greekHead,
                            sectionData.greek,
                            false
                        );
                    }

                    if (mode !== 'greek') {
                        appendTextBlock(
                            sectionData.engHead,
                            sectionData.english,
                            true
                        );
                    }

                    pdfRoot.appendChild(section);
                });

                // ADD PDF ELEMENT TO THE DOCUMENT

                document.body.appendChild(pdfRoot);

                try {
                    // Wait for fonts to finish loading.

                    if (document.fonts && document.fonts.ready) {
                        await document.fonts.ready;
                    }

                    // PDF SETTINGS

                    const options = {
                        margin: [14, 14, 14, 14],

                        filename: `grammatical-techne-${mode}.pdf`,

                        image: {
                            type: 'jpeg',
                            quality: 0.98
                        },

                        html2canvas: {
                            scale: 2,
                            useCORS: true,
                            backgroundColor: '#ffffff',
                            logging: false,
                            windowWidth: 860,

                            // IMPORTANT PDF FIX:
                            //
                            // html2canvas creates a cloned document.
                            // The PDF element is hidden in the original
                            // document, so we explicitly make it visible
                            // inside the cloned document before capture.

                            onclone: clonedDocument => {
                                const clonedRoot =
                                    clonedDocument.getElementById(
                                        'pdf-export-root'
                                    );

                                if (clonedRoot) {
                                    Object.assign(clonedRoot.style, {
                                        position: 'static',
                                        left: 'auto',
                                        top: 'auto',
                                        margin: '0',
                                        visibility: 'visible',
                                        pointerEvents: 'auto',
                                        zIndex: 'auto',
                                        display: 'block'
                                    });
                                }
                            }
                        },

                        jsPDF: {
                            unit: 'mm',
                            format: 'a4',
                            orientation: 'portrait'
                        },

                        pagebreak: {
                            mode: ['css', 'legacy']
                        }
                    };

                    // GENERATE AND SAVE PDF

                    await window
                        .html2pdf()
                        .set(options)
                        .from(pdfRoot)
                        .save();

                } finally {
                    // Remove the temporary PDF source after export.

                    pdfRoot.remove();
                }
            }

            // EXPORT BUTTON EVENT LISTENERS

            buttons.forEach(btn => {
                btn.addEventListener('click', () => {
                    const mode = langSelect.value;
                    const format = btn.dataset.format;

                    const sections = getSectionData();

                    if (format === 'pdf') {
                        exportPdf(sections, mode).catch(error => {
                            console.error(
                                'PDF export failed:',
                                error
                            );

                            alert(
                                `The PDF could not be created. ${
                                    error.message ||
                                    'Check your internet connection and try again.'
                                }`
                            );
                        });

                        return;
                    }

                    let content;
                    let mime;
                    let ext;

                    switch (format) {
                        case 'txt':
                            content = buildTxt(sections, mode);
                            mime = 'text/plain;charset=utf-8';
                            ext = 'txt';
                            break;

                        case 'md':
                            content = buildMd(sections, mode);
                            mime = 'text/markdown;charset=utf-8';
                            ext = 'md';
                            break;

                        case 'xml':
                            content = buildXml(sections, mode);
                            mime = 'application/xml;charset=utf-8';
                            ext = 'xml';
                            break;

                        case 'json':
                            content = buildJson(sections, mode);
                            mime = 'application/json;charset=utf-8';
                            ext = 'json';
                            break;

                        default:
                            return;
                    }

                    const filename =
                        `grammatical-techne-${mode}.${ext}`;

                    download(filename, content, mime);
                });
            });
        })();

    } catch (error) {
        console.error('Error loading grammar:', error);

        document.getElementById('grammar-container').innerHTML =
            '<p style="color:var(--accent); max-width:40rem; margin:2rem auto; text-align:center;">' +
            'Error loading grammar content. Please check that the XML files exist in the TEXT/ folder.' +
            '</p>';
    }
}

document.addEventListener('DOMContentLoaded', loadGrammar);
