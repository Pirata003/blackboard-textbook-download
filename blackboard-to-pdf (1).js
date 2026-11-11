(async () => {
  /* ================= self-contained PDF builder (JPEG pages -> PDF, no libraries) ================= */
  function buildPdf(pages) {
    const enc = new TextEncoder();
    const chunks = [];
    let pos = 0;
    const pushB = b => { chunks.push(b); pos += b.length; };
    const pushS = s => pushB(enc.encode(s));
    const n = pages.length;
    const numObjs = 2 + n * 3;
    const off = new Array(numObjs + 1).fill(0);
    pushB(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a])); // %PDF-1.4
    pushB(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker
    const wObj = (num, body) => { off[num] = pos; pushS(num + ' 0 obj\n' + body + '\nendobj\n'); };
    wObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    wObj(2, '<< /Type /Pages /Count ' + n + ' /Kids [' + pages.map((_, i) => (3 + i * 3) + ' 0 R').join(' ') + '] >>');
    pages.forEach((p, i) => {
      const pg = 3 + i * 3, im = 4 + i * 3, ct = 5 + i * 3;
      wObj(pg, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + p.w + ' ' + p.h + '] /Resources << /XObject << /Im0 ' + im + ' 0 R >> >> /Contents ' + ct + ' 0 R >>');
      off[im] = pos;
      pushS(im + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.data.length + ' >>\nstream\n');
      pushB(p.data);
      pushS('\nendstream\nendobj\n');
      const cs = enc.encode('q ' + p.w + ' 0 0 ' + p.h + ' 0 0 cm /Im0 Do Q\n');
      off[ct] = pos;
      pushS(ct + ' 0 obj\n<< /Length ' + cs.length + ' >>\nstream\n');
      pushB(cs);
      pushS('\nendstream\nendobj\n');
    });
    const xrefPos = pos;
    let x = 'xref\n0 ' + (numObjs + 1) + '\n0000000000 65535 f \n';
    for (let k = 1; k <= numObjs; k++) x += String(off[k]).padStart(10, '0') + ' 00000 n \n';
    pushS(x);
    pushS('trailer\n<< /Size ' + (numObjs + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
  /* zip builder (fallback if PDF assembly ever fails) */
  function buildZipFiles(files) {
    const enc = new TextEncoder();
    const T = (() => { const t = new Uint32Array(256); for (let k = 0; k < 256; k++) { let c = k; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[k] = c >>> 0; } return t; })();
    const crc = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunks = [], central = [];
    let offset = 0;
    const TIME = 0, DATE = (40 << 9) | (1 << 5) | 1;
    for (const f of files) {
      const nb = enc.encode(f.name);
      const c = crc(f.data), sz = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(10, TIME, true); h.setUint16(12, DATE, true);
      h.setUint32(14, c, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true); h.setUint16(26, nb.length, true);
      chunks.push(new Uint8Array(h.buffer), nb, f.data);
      central.push({ nb, c, sz, offset });
      offset += 30 + nb.length + sz;
    }
    const cd = []; let cdSz = 0;
    for (const e of central) {
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
      c.setUint16(12, TIME, true); c.setUint16(14, DATE, true);
      c.setUint32(16, e.c, true); c.setUint32(20, e.sz, true); c.setUint32(24, e.sz, true);
      c.setUint16(28, e.nb.length, true); c.setUint32(42, e.offset, true);
      cd.push(new Uint8Array(c.buffer), e.nb); cdSz += 46 + e.nb.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, central.length, true); end.setUint16(10, central.length, true);
    end.setUint32(12, cdSz, true); end.setUint32(16, offset, true);
    chunks.push(...cd, new Uint8Array(end.buffer));
    return new Blob(chunks, { type: 'application/zip' });
  }
  /* ============ read the book in THIS browser (your login does the unlocking) ============ */
  try {
    if (!/\/bbcswebdav\/courses\//.test(location.pathname)) throw new Error('This is not the textbook page. Open the TEXTBOOK tab (its address shows /bbcswebdav/courses/... in the address bar) and run this there.');
    /* the book folder can sit at any depth (e.g. /COURSE/ or /COURSE/book/):
       probe this folder and each parent until files/pages/ is found */
    const rawPath = location.pathname;
    const cands = [];
    const pushC = c => { const full = location.origin + c; if (cands.indexOf(full) < 0) cands.push(full); };
    if (!rawPath.endsWith('/') && !/\.[a-z0-9]+$/i.test(rawPath)) pushC(rawPath + '/'); // last segment may itself be the book folder
    let dir = rawPath.endsWith('/') ? rawPath : rawPath.replace(/[^/]*$/, '');
    for (let i = 0; i < 5; i++) {
      pushC(dir);
      const parent = dir.replace(/\/[^/]+\/$/, '/');
      if (parent === dir) break;
      dir = parent;
    }
    const overlay = document.createElement('div');
    overlay.textContent = 'Saving textbook…';
    overlay.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#1a202c;color:#fff;padding:10px 16px;border-radius:10px;font:600 13px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.45)';
    document.documentElement.appendChild(overlay);
    const say = t => { overlay.textContent = t; console.log('[book] ' + t); };

    const loadImg = (u, cors) => new Promise(res => { const i = new Image(); if (cors) i.crossOrigin = cors; i.onload = () => res(i); i.onerror = () => res(null); i.src = u; });
    function saveBlob(blob, filename) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 300000);
    }
    function saveAnchor(url, filename) {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 5000);
    }

    // 1. find the book folder + the page image pattern
    say('Looking for the page images…');
    const rends = ['tablet', 'screen', 'print', 'mobile', ''], exts = ['jpg', 'jpeg', 'png', 'webp'];
    let root = null, pre = null, ext = null;
    for (const cand of cands) {
      for (const r of rends) {
        for (const e of exts) {
          if (await loadImg(cand + 'files/pages/' + (r ? r + '/' : '') + '1.' + e)) { root = cand; pre = 'files/pages/' + (r ? r + '/' : ''); ext = e; break; }
        }
        if (pre) break;
      }
      if (pre) break;
    }
    if (!pre) throw new Error('No page images were found near this page. Make sure you are on the textbook viewer page (its address contains /bbcswebdav/courses/).');

    // 2. count the pages (plain image loads until the first one that fails)
    const pageUrl = n => root + pre + n + '.' + ext;
    say('Counting the pages…');
    const urls = [];
    for (let n = 1; n <= 5000; n++) {
      let img = await loadImg(pageUrl(n));
      if (!img) { await new Promise(r => setTimeout(r, 1500)); img = await loadImg(pageUrl(n)); } // one retry
      if (!img) break;
      urls.push(pageUrl(n));
      if (n % 25 === 0) say('Counted ' + urls.length + ' pages…');
    }
    if (!urls.length) throw new Error('The pages would not load (your login may have expired — refresh the textbook and run it again).');
    say('Book found: ' + urls.length + ' pages.');

    const seg = decodeURIComponent(new URL(root).pathname).replace(/\/+$/, '').split('/');
    const baseName = seg.length >= 2 ? seg[seg.length - 2] + '-' + seg[seg.length - 1] : 'textbook';

    // 3. mode A: try to read a page cleanly (with CORS) so a single PDF can be built
    async function pdfPage(u) {
      for (const cors of ['anonymous', 'use-credentials']) {
        const img = await loadImg(u, cors);
        if (img && img.naturalWidth) {
          try {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
            if (blob) return { data: new Uint8Array(await blob.arrayBuffer()), w: img.naturalWidth, h: img.naturalHeight };
          } catch (e) { /* canvas tainted under this mode */ }
        }
      }
      return null;
    }
    const probe = await pdfPage(urls[0]);
    if (probe) {
      say('Building the PDF (' + urls.length + ' pages)…');
      const pages = [probe];
      for (let n = 1; n < urls.length; n++) {
        const p = await pdfPage(urls[n]);
        if (p) pages.push(p);
        if (n % 10 === 0) say('Saved ' + pages.length + ' of ' + urls.length + ' pages…');
      }
      const blob = new Blob([buildPdf(pages)], { type: 'application/pdf' });
      saveBlob(blob, baseName + '.pdf');
      say('DONE: ' + baseName + '.pdf — ' + pages.length + ' pages, ' + Math.round(blob.size / 1048576) + ' MB, saving to your Downloads.');
    } else {
      // mode B: the browser protects these images from copying — download the files themselves
      say('Getting every page. Chrome will ask ONCE to allow multiple downloads — click ALLOW when it does.');
      const pad = String(urls.length).length;
      for (let n = 0; n < urls.length; n++) {
        saveAnchor(urls[n], baseName + '/page-' + String(n + 1).padStart(pad, '0') + '.' + ext);
        if (n % 10 === 0) say('Downloading page ' + (n + 1) + ' of ' + urls.length + '…');
        await new Promise(r => setTimeout(r, 400));
      }
      say('DONE: ' + urls.length + ' pages are going into your Downloads, folder "' + baseName + '". Leave this tab open until the download arrow stops moving.');
    }
    setTimeout(() => overlay.remove(), 60000);
  } catch (e) {
    console.error('blackboard-to-pdf failed:', e && e.message);
    alert('blackboard-to-pdf: ' + ((e && e.message) || 'failed — open the Console (F12) for details'));
  }
})();
