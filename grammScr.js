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
            localStorage.setItem('grammar-english-visible', on ? '1' : '0');
        }
        englishToggle.addEventListener('change', () => {
            setEnglish(englishToggle.checked);
        });
        if (localStorage.getItem('grammar-english-visible') === '1') {
            englishToggle.checked = true;
            setEnglish(true);
        }
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
        goToSectionFromHash();
        window.addEventListener('hashchange', goToSectionFromHash);
        (function () {
            const input = document.getElementById('search-input');
            const button = document.getElementById('search-button');
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
            function highlightText(query) {
                clearHighlights();
                if (!query.trim()) {
                    matches = [];
                    currentMatchIndex = -1;
                    return;
                }
                const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const searchRegex = new RegExp(escaped, 'gi');
                const testRegex = new RegExp(escaped, 'i');
                const walker = document.createTreeWalker(
                    content,
                    NodeFilter.SHOW_TEXT,
                    {
                        acceptNode(node) {
                            if (node.parentNode.tagName === 'SCRIPT' ||
                                node.parentNode.tagName === 'STYLE' ||
                                node.parentNode.closest('.search-container') ||
                                node.parentNode.closest('.site-header')) {
                                return NodeFilter.FILTER_REJECT;
                            }
                            return testRegex.test(node.textContent)
                                ? NodeFilter.FILTER_ACCEPT
                                : NodeFilter.FILTER_SKIP;
                        }
                    }
                );
                const nodesToProcess = [];
                let node;
                while ((node = walker.nextNode())) {
                    nodesToProcess.push(node);
                }
                nodesToProcess.forEach(textNode => {
                    const parent = textNode.parentNode;
                    const frag = document.createDocumentFragment();
                    let text = textNode.textContent;
                    let lastIndex = 0;
                    searchRegex.lastIndex = 0;
                    let match;
                    while ((match = searchRegex.exec(text)) !== null) {
                        if (match.index > lastIndex) {
                            frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
                        }
                        const mark = document.createElement('mark');
                        mark.textContent = match[0];
                        frag.appendChild(mark);
                        lastIndex = searchRegex.lastIndex;
                        if (match[0].length === 0) searchRegex.lastIndex++;
                    }
                    if (lastIndex < text.length) {
                        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
                    }
                    parent.replaceChild(frag, textNode);
                });
                matches = Array.from(content.querySelectorAll('mark'));
                currentMatchIndex = -1;
            }
            function goToNextMatch() {
                if (matches.length === 0) return;
                currentMatchIndex = (currentMatchIndex + 1) % matches.length;
                matches[currentMatchIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            input.addEventListener('input', () => highlightText(input.value));
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
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
            const data = {
                scrollY: window.scrollY,
                englishVisible: document.body.classList.contains('english-on'),
                timestamp: Date.now()
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }
        setInterval(savePosition, 4000);
        window.addEventListener('beforeunload', savePosition);
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const data = JSON.parse(saved);
                if (Date.now() - data.timestamp < 30 * 24 * 60 * 60 * 1000) {
                    const want = confirm('Continue where you left off?');
                    if (want) {
                        if (data.englishVisible) {
                            englishToggle.checked = true;
                            setEnglish(true);
                        }
                        setTimeout(() => {
                            window.scrollTo(0, data.scrollY || 0);
                        }, 300);
                    }
                }
            } catch (e) {
                console.warn('Could not restore position', e);
            }
        }
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
            function exportPdf(sections, mode) {
                const win = window.open('', '_blank');
                let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Grammatical Techne – Export</title>
<style>
@page {
margin: 2cm;
}
body {
font-family: "Gentium Plus", "Palatino Linotype", Palatino, Georgia, serif;
font-size: 11pt;
line-height: 1.55;
color: #2c241c;
max-width: 18cm;
margin: 0 auto;
}
h1 {
text-align: center;
font-size: 18pt;
letter-spacing: 0.08em;
color: #6b3a28;
margin-bottom: 1.8rem;
}
.section {
margin-bottom: 2rem;
page-break-inside: avoid;
}
h2 {
font-size: 13pt;
color: #6b3a28;
border-bottom: 1px solid #d4c9b4;
padding-bottom: 0.25rem;
margin: 0 0 0.6rem;
}
h3 {
font-size: 11.5pt;
margin: 1rem 0 0.4rem;
color: #5c4f42;
}
.body-text {
white-space: pre-wrap;
margin: 0 0 0.8rem;
}
.english-block {
color: #5c4f42;
font-size: 10.5pt;
}
@media print {
body { padding: 0; }
}
</style>
</head>
<body>
<h1>GRAMMATICAL TECHNE</h1>
`;
                sections.forEach(s => {
                    html += `<div class="section">
<h2>§ ${s.n}</h2>`;
                    if (mode !== 'english') {
                        html += `
<h3>${escapeHtml(s.greekHead)}</h3>
<div class="body-text">${escapeHtml(s.greek)}</div>`;
                    }
                    if (mode !== 'greek') {
                        html += `
<h3>${escapeHtml(s.engHead)}</h3>
<div class="body-text english-block">${escapeHtml(s.english)}</div>`;
                    }
                    html += `</div>`;
                });
                html += `
<script>
window.onload = function () {
setTimeout(function () { window.print(); }, 300);
};
<\/script>
</body>
</html>`;
                win.document.write(html);
                win.document.close();
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
                        exportPdf(sections, mode);
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
