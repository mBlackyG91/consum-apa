/* Generator PDF minimal, fără biblioteci: fiecare pagină A4 este o imagine
 * (desenată pe canvas) inclusă într-un PDF. Imaginea este în tonuri de gri,
 * comprimată fără pierderi (Flate) când browserul are CompressionStream,
 * altfel JPEG. Așa diacriticele românești apar corect pe orice dispozitiv. */
(function () {
  'use strict';

  const enc = new TextEncoder();
  const A4_W_PT = 595.28, A4_H_PT = 841.89;

  async function deflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function canvasToImage(canvas) {
    const w = canvas.width, h = canvas.height;
    if (typeof CompressionStream === 'function') {
      try {
        const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
        const gray = new Uint8Array(w * h);
        for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = px[i + 1];
        return { w, h, data: await deflate(gray), dict: '/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode' };
      } catch (e) { /* trecem la JPEG */ }
    }
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
    return { w, h, data: new Uint8Array(await blob.arrayBuffer()), dict: '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode' };
  }

  /** @param {HTMLCanvasElement[]} canvases  o pagină A4 per canvas */
  async function buildPdf(canvases, title) {
    const images = [];
    for (const c of canvases) images.push(await canvasToImage(c));

    const chunks = [];
    const offsets = [];
    let pos = 0;
    const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); pos += b.length; };
    const obj = (n, body) => { offsets[n] = pos; push(n + ' 0 obj\n'); body(); push('\nendobj\n'); };

    const n = images.length;
    // 1 catalog, 2 pages, 3 info, apoi per pagină: page, content, image
    const pageId = (i) => 4 + i * 3, contentId = (i) => 5 + i * 3, imageId = (i) => 6 + i * 3;
    const total = 4 + n * 3;

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push('<< /Type /Pages /Count ' + n + ' /Kids [' + images.map((_, i) => pageId(i) + ' 0 R').join(' ') + '] >>'));
    const safeTitle = String(title || '').replace(/[^\x20-\x7E]/g, '').replace(/([()\\])/g, '\\$1');
    obj(3, () => push('<< /Title (' + safeTitle + ') /Producer (Evidenta apa) >>'));
    images.forEach((img, i) => {
      obj(pageId(i), () => push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + A4_W_PT + ' ' + A4_H_PT + '] ' +
        '/Resources << /XObject << /Im0 ' + imageId(i) + ' 0 R >> >> /Contents ' + contentId(i) + ' 0 R >>'));
      const content = 'q ' + A4_W_PT + ' 0 0 ' + A4_H_PT + ' 0 0 cm /Im0 Do Q';
      obj(contentId(i), () => { push('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'); });
      obj(imageId(i), () => {
        push('<< /Type /XObject /Subtype /Image /Width ' + img.w + ' /Height ' + img.h + ' ' + img.dict + ' /Length ' + img.data.length + ' >>\nstream\n');
        push(img.data);
        push('\nendstream');
      });
    });
    const xref = pos;
    let x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    push(x);
    push('trailer\n<< /Size ' + total + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(chunks, { type: 'application/pdf' });
  }

  window.PdfMaker = { buildPdf };
})();
