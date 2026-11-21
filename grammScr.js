async function loadXML(filePath) {
    const response = await fetch(filePath);
    const text = await response.text();
    const parser = new DOMParser();
    return parser.parseFromString(text, 'text/xml');
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
        function renderSectionContent(section) {
            let html = '';
            const n = section.getAttribute('n');
            if (n) {
                html += `<div class="section-number">§ ${n}</div>`;
            }
            const head = section.querySelector('head');
            if (head) {
                html += `<div class="section-head">${head.textContent}</div>`;
            }
            for (let child of section.children) {
                if (child.tagName === 'head') continue;
                const tag = child.tagName.toLowerCase();
                if (tag === 'p') {
                    html += `<p>${child.textContent}</p>`;
                } else if (tag === 'list') {
                    html += `<list>`;
                    child.querySelectorAll('item').forEach(item => {
                        html += `<item>${item.textContent}</item>`;
                    });
                    html += `</list>`;
                } else if (tag === 'quote') {
                    html += `<quote>${child.textContent}</quote>`;
                } else {
                    html += `<${tag}>${child.textContent}</${tag}>`;
                }
            }
            return html;
        }
        greekSections.forEach(greekSec => {
            const n = greekSec.getAttribute('n');
            const englishSec = englishMap[n];
            const pair = document.createElement('div');
            pair.className = 'section-pair';
            pair.dataset.n = n;
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
                engCol.innerHTML = `<p><em>(No matching section)</em></p>`;
            }
            pair.appendChild(engCol);
            container.appendChild(pair);
        });
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
            const target = document.querySelector(`.section-pair[data-n="${n}"]`);
            if (target) {
                history.pushState(null, '', `#section-${n}`);
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            sectionSelect.value = '';
        });
        const englishToggle = document.getElementById('english-toggle');
        function setEnglish(on) {
            document.body.classList.toggle('english-on', on);
        }
        englishToggle.checked = false;
        setEnglish(false);
        englishToggle.addEventListener('change', () => {
            setEnglish(englishToggle.checked);
        });
        function goToSectionFromHash() {
            const hash = window.location.hash;
            if (hash && hash.startsWith('#section-')) {
                const n = hash.replace('#section-', '');
                const target = document.querySelector(`.section-pair[data-n="${n}"]`);
                if (target) {
                    setTimeout(() => {
                        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 200);
                }
            }
        }
        window.addEventListener('hashchange', goToSectionFromHash);
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
                    parent.replaceChild(document.createTextNode(mark.textContent), mark);
                    parent.normalize();
                });
            }

            // Normalize text for searching while retaining a map back to the original
            // UTF-16 character positions, so highlighted text keeps its Greek accents.
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
                    // Treat Greek final sigma and ordinary sigma as equivalent in search.
                    piece = piece.replace(/ς/g, 'σ');

                    // When a decomposed accent is removed, extend the preceding
                    // character's mapped range so the whole grapheme is highlighted.
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
                return { text: normalized, starts: originalStarts, ends: originalEnds };
            }

            function highlightText(query) {
                clearHighlights();
                matches = [];
                currentMatchIndex = -1;

                if (!query.trim()) return;

                const ignoreAccents = accentMode.value === 'insensitive';
                const normalizedQuery = normalizeWithMap(query, ignoreAccents).text;
                if (!normalizedQuery) return;

                const escaped = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const searchRegex = new RegExp(escaped, 'g');
                const walker = document.createTreeWalker(
                    content,
                    NodeFilter.SHOW_TEXT,
                    {
                        acceptNode(node) {
                            const parent = node.parentNode;
                            if (!parent ||
                                parent.tagName === 'SCRIPT' ||
                                parent.tagName === 'STYLE' ||
                                parent.closest('.search-container') ||
                                parent.closest('.site-header')) {
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
                    const mapped = normalizeWithMap(originalText, ignoreAccents);
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

                        if (originalStart === undefined || originalEnd === undefined || originalStart < lastOriginalIndex) {
                            continue;
                        }

                        if (originalStart > lastOriginalIndex) {
                            fragment.appendChild(document.createTextNode(
                                originalText.slice(lastOriginalIndex, originalStart)
                            ));
                        }

                        const mark = document.createElement('mark');
                        mark.textContent = originalText.slice(originalStart, originalEnd);
                        fragment.appendChild(mark);
                        lastOriginalIndex = originalEnd;
                    }

                    if (lastOriginalIndex === 0) return;
                    if (lastOriginalIndex < originalText.length) {
                        fragment.appendChild(document.createTextNode(originalText.slice(lastOriginalIndex)));
                    }
                    textNode.parentNode.replaceChild(fragment, textNode);
                });

                matches = Array.from(content.querySelectorAll('mark'));
            }

            function goToNextMatch() {
                if (matches.length === 0) return;
                currentMatchIndex = (currentMatchIndex + 1) % matches.length;
                matches[currentMatchIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            input.addEventListener('input', () => highlightText(input.value));
            accentMode.addEventListener('change', () => highlightText(input.value));
            input.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    if (matches.length > 0) goToNextMatch();
                }
            });
            button.addEventListener('click', () => {
                highlightText(input.value);
                if (matches.length > 0) goToNextMatch();
                input.focus();
            });
        })();
        const backBtn = document.getElementById('back-to-top');
        window.addEventListener('scroll', () => {
            if (window.scrollY > 400) {
                backBtn.classList.add('visible');
            } else {
                backBtn.classList.remove('visible');
            }
        });
        backBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        let scrollTimeout = null;
        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
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
                    if (n && window.location.hash !== `#section-${n}`) {
                        history.replaceState(null, '', `#section-${n}`);
                    }
                }
            }, 150);
        });
        const STORAGE_KEY = 'grammar-reading-position';
        function savePosition() {
            const scrollY = window.scrollY;
            const englishVisible = document.body.classList.contains('english-on');

            // Do not recreate a resume record for a page that is still at its
            // untouched first-entry state after the reader chose not to resume.
            if (scrollY <= 100 && !englishVisible) {
                localStorage.removeItem(STORAGE_KEY);
                return;
            }

            const data = {
                scrollY: scrollY,
                englishVisible: englishVisible,
                timestamp: Date.now()
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }
        function clearPreviousReadingState() {
            localStorage.removeItem(STORAGE_KEY);
            // Remove the legacy key used by the previous version as well.
            localStorage.removeItem('grammar-english-visible');
            englishToggle.checked = false;
            setEnglish(false);
            window.scrollTo(0, 0);
            clearTimeout(scrollTimeout);
            if (window.location.hash) {
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }
        }

        const saved = localStorage.getItem(STORAGE_KEY);
        let resumedPreviousSession = false;

        // English visibility is restored only as part of an accepted reading session.
        // A first visit, an expired record, or declining the prompt starts from defaults.
        localStorage.removeItem('grammar-english-visible');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                const isRecent = data && Number.isFinite(data.timestamp) &&
                    Date.now() - data.timestamp < 30 * 24 * 60 * 60 * 1000;

                if (isRecent) {
                    const wantsToResume = confirm('Continue where you left off?');
                    if (wantsToResume) {
                        resumedPreviousSession = true;
                        englishToggle.checked = Boolean(data.englishVisible);
                        setEnglish(englishToggle.checked);
                        const savedScrollY = Number.isFinite(data.scrollY) ? Math.max(0, data.scrollY) : 0;
                        setTimeout(() => window.scrollTo(0, savedScrollY), 300);
                    } else {
                        clearPreviousReadingState();
                    }
                } else {
                    localStorage.removeItem(STORAGE_KEY);
                }
            } catch (error) {
                console.warn('Could not restore position; starting from the beginning.', error);
                localStorage.removeItem(STORAGE_KEY);
            }
        }

        if (!resumedPreviousSession) {
            goToSectionFromHash();
        }
        setInterval(savePosition, 4000);
        window.addEventListener('beforeunload', savePosition);
        import("https://cdn.jsdelivr.net/npm/alpheios-embedded@latest/dist/alpheios-embedded.min.js")
            .then(() => window.AlpheiosEmbed.importDependencies({ mode: 'cdn' }))
            .then(Embedded => {
                new Embedded({
                    clientId: 'grammatical-techne',
                    enabledSelector: '.alpheios-enabled',
                    simpleMode: false,
                    toolbarInitialPos: { top: '140px', right: '15px' },
                    popupInitialPos: { top: '160px', left: '10vw' }
                }).activate();
            })
            .catch(e => console.error('Alpheios failed to load:', e));
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
                    const greekHead = greekEl.querySelector('.section-head')?.textContent.trim() || '';
                    const engHead = engEl.querySelector('.section-head')?.textContent.trim() || '';
                    function collectText(el) {
                        const parts = [];
                        el.querySelectorAll('p, quote, item, .section-number').forEach(node => {
                            const t = node.textContent.trim();
                            if (t) parts.push(t);
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
            function download(filename, content, mime) {
                const blob = new Blob([content], { type: mime });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
            }
            function buildTxt(sections, mode) {
                let out = 'GRAMMATICAL TECHNE\n' + '='.repeat(40) + '\n\n';
                sections.forEach(s => {
                    out += `§ ${s.n}\n`;
                    if (mode !== 'english') {
                        out += s.greekHead + '\n' + s.greek + '\n\n';
                    }
                    if (mode !== 'greek') {
                        out += (mode === 'both' ? 'ENGLISH\n' : '') + s.engHead + '\n' + s.english + '\n\n';
                    }
                    out += '-'.repeat(40) + '\n\n';
                });
                return out;
            }
            function buildMd(sections, mode) {
                let out = '# Grammatical Techne\n\n';
                sections.forEach(s => {
                    out += `## § ${s.n}\n\n`;
                    if (mode !== 'english') {
                        out += `### ${s.greekHead}\n\n`;
                        out += s.greek.replace(/\n{3,}/g, '\n\n') + '\n\n';
                    }
                    if (mode !== 'greek') {
                        out += `### ${s.engHead}\n\n`;
                        out += s.english.replace(/\n{3,}/g, '\n\n') + '\n\n';
                    }
                    out += '---\n\n';
                });
                return out;
            }
            function buildXml(sections, mode) {
                let out = '<?xml version="1.0" encoding="UTF-8"?>\n<work>\n';
                sections.forEach(s => {
                    out += ` <section n="${s.n}">\n`;
                    if (mode !== 'english') {
                        out += ` <head>${escapeXml(s.greekHead)}</head>\n`;
                        out += ` <p>${escapeXml(s.greek)}</p>\n`;
                    }
                    if (mode !== 'greek') {
                        out += ` <head lang="en">${escapeXml(s.engHead)}</head>\n`;
                        out += ` <p lang="en">${escapeXml(s.english)}</p>\n`;
                    }
                    out += ` </section>\n`;
                });
                out += '</work>';
                return out;
            }
            function buildJson(sections, mode) {
                const cleaned = sections.map(s => {
                    const obj = { n: s.n };
                    if (mode !== 'english') {
                        obj.greek = { head: s.greekHead, text: s.greek };
                    }
                    if (mode !== 'greek') {
                        obj.english = { head: s.engHead, text: s.english };
                    }
                    return obj;
                });
                return JSON.stringify(cleaned, null, 2);
            }
            function escapeXml(str) {
                return str
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&apos;');
            }
            async function exportPdf(sections, mode) {
                if (typeof window.html2pdf !== 'function') {
                    throw new Error('The PDF library did not load. Check your internet connection and reload the page.');
                }

                /* ------------------------------------------------------------------
                   Work out the printable area of the page first.

                   html2pdf measures everything in CSS pixels, drops the source
                   element into a fixed-size capture container (the page's inner
                   width) and only afterwards scales that canvas down to the paper
                   width. If the exported element is wider than that container, or
                   if it is centred with automatic margins, the container's
                   overflow clipping shifts the content sideways and text is cut
                   off on the left edge of the resulting PDF.

                   Sizing the export root explicitly to the printable width - and
                   keeping every margin at zero so nothing can move it sideways -
                   guarantees the whole column lands inside the page.

                   The element also has to stay in the normal document flow at a
                   real, on-screen position: html2pdf.js moves the source element
                   into its own rendering container before calling html2canvas, so
                   any inline `position:absolute; left:-10000px` travels with it
                   and places the content outside the captured area.
                ------------------------------------------------------------------ */
                const PAGE_WIDTH_MM = 210;
                const PAGE_HEIGHT_MM = 297;
                const PAGE_MARGIN_MM = 14;
                const MM_TO_PX = 96 / 25.4;
                // A4 printable width in CSS px, minus a couple of pixels of
                // rounding headroom so the right edge is never clipped either.
                const printableWidthPx = Math.floor(
                    (PAGE_WIDTH_MM - PAGE_MARGIN_MM * 2) * MM_TO_PX
                ) - 4;

                const pdfRoot = document.createElement('article');
                pdfRoot.className = 'pdf-export-document';
                Object.assign(pdfRoot.style, {
                    position: 'relative',
                    left: '0',
                    top: '0',
                    right: 'auto',
                    bottom: 'auto',
                    width: printableWidthPx + 'px',
                    minWidth: printableWidthPx + 'px',
                    maxWidth: printableWidthPx + 'px',
                    margin: '0',
                    padding: '24px 28px',
                    background: '#ffffff',
                    color: '#2c241c',
                    fontFamily: '"Gentium Plus", "Palatino Linotype", Palatino, Georgia, serif',
                    fontSize: '15px',
                    lineHeight: '1.55',
                    boxSizing: 'border-box',
                    transform: 'none',
                    float: 'none'
                });

                const title = document.createElement('h1');
                title.textContent = 'GRAMMATICAL TECHNE';
                Object.assign(title.style, {
                    margin: '0 0 28px',
                    textAlign: 'center',
                    fontSize: '25px',
                    letterSpacing: '0.08em',
                    color: '#6b3a28'
                });
                pdfRoot.appendChild(title);

                sections.forEach(sectionData => {
                    const section = document.createElement('section');
                    section.className = 'pdf-section';
                    Object.assign(section.style, {
                        marginBottom: '30px',
                        breakInside: 'auto',
                        pageBreakInside: 'auto'
                    });

                    const sectionHeading = document.createElement('h2');
                    sectionHeading.textContent = `§ ${sectionData.n}`;
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

                    function appendTextBlock(headingText, bodyText, isEnglish = false) {
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
                            color: isEnglish ? '#5c4f42' : '#2c241c',
                            fontSize: isEnglish ? '14px' : '15px'
                        });
                        section.appendChild(body);
                    }

                    if (mode !== 'english') {
                        appendTextBlock(sectionData.greekHead, sectionData.greek, false);
                    }
                    if (mode !== 'greek') {
                        appendTextBlock(sectionData.engHead, sectionData.english, true);
                    }
                    pdfRoot.appendChild(section);
                });

                document.body.appendChild(pdfRoot);
                // Force a synchronous layout so html2pdf clones a fully laid-out tree.
                void pdfRoot.getBoundingClientRect();

                try {
                    if (document.fonts && document.fonts.ready) {
                        await document.fonts.ready;
                    }

                    const options = {
                        margin: [PAGE_MARGIN_MM, PAGE_MARGIN_MM, PAGE_MARGIN_MM, PAGE_MARGIN_MM],
                        filename: `grammatical-techne-${mode}.pdf`,
                        image: { type: 'jpeg', quality: 0.98 },
                        html2canvas: {
                            scale: 2,
                            useCORS: true,
                            backgroundColor: '#ffffff',
                            logging: false,
                            scrollX: 0,
                            scrollY: 0,
                            windowWidth: Math.max(printableWidthPx + 80, window.innerWidth || 1024),
                            windowHeight: Math.max(800, window.innerHeight || 800),
                            // Belt-and-braces: whatever html2pdf does with the clone,
                            // pin the export root to the top-left of the capture area
                            // and lock its width so it cannot be pushed sideways or
                            // clipped by the capture container.
                            onclone: clonedDoc => {
                                const root = clonedDoc.querySelector('.pdf-export-document');
                                if (root) {
                                    root.style.position = 'static';
                                    root.style.left = '0';
                                    root.style.top = '0';
                                    root.style.right = 'auto';
                                    root.style.bottom = 'auto';
                                    root.style.margin = '0';
                                    root.style.transform = 'none';
                                    root.style.float = 'none';
                                    root.style.width = printableWidthPx + 'px';
                                    root.style.minWidth = printableWidthPx + 'px';
                                    root.style.maxWidth = printableWidthPx + 'px';
                                }
                            }
                        },
                        jsPDF: {
                            unit: 'mm',
                            format: 'a4',
                            orientation: 'portrait'
                        },
                        pagebreak: { mode: ['css', 'legacy'] }
                    };

                    await window.html2pdf().set(options).from(pdfRoot).save();
                } finally {
                    pdfRoot.remove();
                }
            }
            function escapeHtml(str) {
                return str
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');
            }
            buttons.forEach(btn => {
                btn.addEventListener('click', () => {
                    const mode = langSelect.value;
                    const format = btn.dataset.format;
                    const sections = getSectionData();
                    if (format === 'pdf') {
                        exportPdf(sections, mode).catch(error => {
                            console.error('PDF export failed:', error);
                            alert('The PDF could not be created. Check your internet connection and try again.');
                        });
                        return;
                    }
                    let content, mime, ext;
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
                    }
                    const filename = `grammatical-techne-${mode}.${ext}`;
                    download(filename, content, mime);
                });
            });
        })();
    } catch (error) {
        console.error('Error loading grammar:', error);
        document.getElementById('grammar-container').innerHTML =
            `<p style="color:var(--accent); max-width:40rem; margin:2rem auto; text-align:center;">
Error loading grammar content. Please check that the XML files exist in the TEXT/ folder.
</p>`;
    }
}
document.addEventListener('DOMContentLoaded', loadGrammar);
